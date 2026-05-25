const axios = require("axios");
const crypto = require('crypto');
require('dotenv').config();
const { EMA } = require("technicalindicators");
const { getLatestPrice, getLatestCandle } = require("./binanceWebSocket");
const WebSocket = require("ws");

let LiveTrading = true
let BinanceTrading = false
let symbol = process.env.symbol;
let currentBalance = 1000
const SL_ATR_MULT = 1.5;
const RR_TARGET = 1.5;

// Adjust these for your symbol's tickSize / lotSize
const PRICE_PRECISION = 2;  // e.g. 2 decimals for BNBUSDT
const QTY_PRECISION = 1;

//---------------------------

let userWS = null;
let listenKey = null;
let keepAliveTimer = null;

// store what we need for “instant SL move”
let liveTradeCtx = null;
// { symbol, type, entryPrice, tpPctDec, tp1OrderId, slClientAlgoId }

const partialLevelPct = 0.3; // Take Partial At 30% tp
const PARTIAL_LOCK_PCT_OF_TP = 0.05; // 5% of the full TP distance after Partial Hit
let partialLockedSLPrice = null;
const TP_ATR_MULT = SL_ATR_MULT * RR_TARGET;
let activeSlOrderId = null;
const BASE_FAPI_URL = 'https://fapi.binance.com'; // Futures mainnet
const mainBotUrl = "https://binance-testing.fly.dev"
let intervalRef = null;
let lastSignal = null; // <-- Declare here to keep it across calls
let tradeCount = 0; // Global scope (top of the script)
let prevTradeType = null;
let prevTradeTime = null;
let prevTradePrice = null;
let prevTradeObjectId = null;
let tradeCandleCloses = []; // Stores candle closes while trade is open
let partialTPHit = false; // have we taken the 50% partial on current trade?
let currentTP = 0
let currentSL = 0
let lastTradeSignal = null
let emaHistory = []
let subscriptions = [];
let latestEmaPack = null; // { ema9, ema21, ema50, ema200, signal }
const SL_MATCH_PARTIAL = true; // <--- turn on


// Example config (keep your own values)
const OPTIMIZER_DAYS = 30;          // how many days of history to use
const MIN_TRADES_FOR_DATASET = 50;  // minimum trades overall to even run optimizer

// thresholds for Raw ATR combos
const MIN_TRADES_ATR = 20;     // minimum trades for a combo to be considered "good"
const MIN_WR_ATR = 50;        // minimum winrate% for a combo to be considered "good"

// Our Position Size for 100$ in Binance will be = 1000$ position Size with 10x leverage
// Our Position Size for 100$ in Testing will be = 1000$ position Size with no Leverage because we cannot apply leverage in Simultation

// ✅ Safe-wrapped (returns string listenKey or null)
async function createFuturesListenKey() {
  return safeAsync("Create Futures listenKey", async () => {
    const resp = await axios.post(
      "https://fapi.binance.com/fapi/v1/listenKey",
      null,
      { headers: { "X-MBX-APIKEY": process.env.apiKey }, timeout: 15000 }
    );
    return resp?.data?.listenKey || null;
  });
}

// ✅ Safe-wrapped (returns resp.data or null)
async function keepAliveFuturesListenKey(key) {
  return safeAsync("KeepAlive Futures listenKey", async () => {
    const resp = await axios.put(
      "https://fapi.binance.com/fapi/v1/listenKey",
      null,
      {
        params: { listenKey: key },
        headers: { "X-MBX-APIKEY": process.env.apiKey },
        timeout: 15000
      }
    );
    return resp?.data ?? null;
  });
}

async function startUserStreamIfNeeded() {
  if (userWS && userWS.readyState === WebSocket.OPEN) return;

  listenKey = await createFuturesListenKey();

  userWS = new WebSocket(`wss://fstream.binance.com/private/ws/${listenKey}`);

  userWS.on("open", () => {
    console.log("👂 UserData stream connected");
  });

  userWS.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // We care about fills:
      if (msg.e !== "ORDER_TRADE_UPDATE") return;

      const o = msg.o; // order payload
      // o.s symbol, o.i orderId, o.X status, o.x executionType
      if (!o) return;

      await handleOrderTradeUpdate(o);
    } catch (e) {
      console.error("UserData parse error:", e.message);
    }
  });

  userWS.on("close", () => {
    console.log("⚠️ UserData stream closed. Reconnecting...");
    stopUserStream();
    setTimeout(() => startUserStreamIfNeeded().catch(() => { }), 2000);
  });

  userWS.on("error", (err) => {
    console.error("❌ UserData WS error:", err.message);
  });

  // keepalive every 25-30 mins
  keepAliveTimer = setInterval(() => {
    if (listenKey) keepAliveFuturesListenKey(listenKey).catch(() => { });
  }, 50 * 60 * 1000);
}

function stopUserStream() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;

  if (userWS) {
    try { userWS.terminate(); } catch { }
  }
  userWS = null;
  listenKey = null;
}

async function handleOrderTradeUpdate(o) {
  if (!liveTradeCtx) return;
  if (o.s !== liveTradeCtx.symbol) return;
  if (o.x !== "TRADE") return;

  // If you only want to react once TP1 is completely filled:
  if (o.X !== "FILLED") return;

  if (String(o.i) !== String(liveTradeCtx.tp1OrderId)) return;
  if (partialTPHit) return;

  partialTPHit = true;

  // --- 1) extract fill data ---
  const filledQty = Number(o.z ?? o.l);                 // executed quantity
  const fillPrice = Number(o.ap ?? o.L ?? o.p);         // avg fill price preferred
  if (!Number.isFinite(filledQty) || filledQty <= 0) return;
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) return;

  // --- 2) compute remaining position size ---
  const fullQty = Number(liveTradeCtx.fullQty);
  const fullUsd = Number(liveTradeCtx.fullUsd);

  const safeFullQty = fullQty > 0 ? fullQty : filledQty;
  const fractionClosed = Math.min(filledQty / safeFullQty, 1);

  const remainingQty = roundQty(Math.max(safeFullQty - filledQty, 0));
  const remainingUsd = Math.max(fullUsd * (remainingQty / safeFullQty), 0);

  // --- 3) compute closed profit ---
  // Prefer Binance realized pnl if provided by futures stream:
  // (In Binance futures ORDER_TRADE_UPDATE, this is often `rp`)
  let closedProfitUsd = Number(o.rp);
  if (!Number.isFinite(closedProfitUsd)) {
    const pnlPct =
      liveTradeCtx.type === "BUY"
        ? (fillPrice - liveTradeCtx.entryPrice) / liveTradeCtx.entryPrice
        : (liveTradeCtx.entryPrice - fillPrice) / liveTradeCtx.entryPrice;

    closedProfitUsd = pnlPct * fullUsd * fractionClosed;
  }

  // --- 4) move SL immediately (your existing logic) ---
  const lockProfitPct = liveTradeCtx.tpPctDec * PARTIAL_LOCK_PCT_OF_TP;

  const newSlPrice = liveTradeCtx.type === "BUY"
    ? liveTradeCtx.entryPrice * (1 + lockProfitPct)
    : liveTradeCtx.entryPrice * (1 - lockProfitPct);

  let newSlOrderId = null;

  if (BinanceTrading) {
    // cancel old SL
    const oldId = liveTradeCtx.slClientAlgoId;
    if (oldId) await safeAsync("Cancel old SL", () => CancelFuturesPlaceStopMarket(oldId));

    // place new SL
    const beSide = liveTradeCtx.type === "BUY" ? "SELL" : "BUY";
    const beOrder = {
      algoType: "CONDITIONAL",
      symbol: liveTradeCtx.symbol,
      side: beSide,
      type: "STOP_MARKET",
      triggerprice: roundPrice(newSlPrice),
      closePosition: true,
      workingType: "MARK_PRICE",
      timestamp: new Date().toISOString()
    };

    const beResp = await safeAsync("Place locked SL", () => futuresPlaceStopMarket(beOrder));
    newSlOrderId = beResp?.clientAlgoId ? String(beResp.clientAlgoId) : null;

    if (newSlOrderId) {
      liveTradeCtx.slClientAlgoId = newSlOrderId;
      activeSlOrderId = newSlOrderId;
    }
  }

  // --- 5) update DB like your candle-based partial did ---
  await safeAsync("DB upd-partial (from WS)", () =>
    axios.post(`${process.env.backendURL}/bot/upd-partial`, {
      positionSize: remainingQty,
      positionSizeUSD: remainingUsd,
      closedProfit: closedProfitUsd.toFixed(2),
      ...(newSlOrderId ? { slOrderId: newSlOrderId } : {}),
    }, { headers: { Authorization: `Bearer A.saboor786` } })
  );

  console.log("✅ Partial updated from WS", {
    filledQty, fillPrice, remainingQty, remainingUsd, closedProfitUsd
  });
}

function atrMultToPctDec(atr, entryPrice, atrMult) {
  // returns decimal percent (0.01 = 1%)
  return (atr * atrMult) / entryPrice;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function partialPctFromTp(tpPctDec) {
  return tpPctDec * partialLevelPct; // decimal
}

/**
 * Returns the EMA spread multiplier (in ATR multiples) based on where ATR sits in the combo range.
 * - atr near atrMin  -> require more separation  (e.g. 0.25 * ATR)
 * - atr near atrMax  -> require less separation  (e.g. 0.10 * ATR)
 */
function dynamicEmaSpreadMultFromCombo(atr, combo, {
  low = 0.20,   // stricter when ATR is low
  high = 0.10,  // looser when ATR is high
} = {}) {
  if (!combo || !Number.isFinite(combo.atrMin) || !Number.isFinite(combo.atrMax)) {
    return 0.15; // fallback
  }

  const span = combo.atrMax - combo.atrMin;
  if (!Number.isFinite(span) || span <= 0) return 0.15;

  const t = clamp((atr - combo.atrMin) / span, 0, 1); // 0..1 inside the range
  return lerp(low, high, t);
}

function hasEnoughEMASpread({ ema9, ema21, ema50 }, atr, mult) {
  if (![ema9, ema21, ema50, atr, mult].every(Number.isFinite)) return false;
  const minAbs = mult * atr;
  return (Math.abs(ema9 - ema21) > minAbs) && (Math.abs(ema21 - ema50) > minAbs);
}

async function futuresPlaceStopMarket(params) {
  // try normal endpoint first
  try {
    return await futuresPostSigned("/fapi/v1/algoOrder", params);
  } catch (e) {
    const details = e?.response?.data || e?.message || e;
    console.error(`Place Algo B.E Order Err:`, details);
  }
}

async function CancelFuturesPlaceStopMarket(clientAlgoId) {
  // try normal endpoint first
  try {
    return await futuresDeleteSigned("/fapi/v1/algoOrder", { clientAlgoId });
  } catch (e) {
    const details = e?.response?.data || e?.message || e;
    console.error(`Place Algo B.E Order Err:`, details);
  }
}

async function callFailoverExec(payload) {
  if (!mainBotUrl) throw new Error("mainBotUrl not set");
  const url = `${mainBotUrl}/bot/exec`;

  const resp = await axios.post(url, payload, {
    headers: { Authorization: `Bearer A.saboor786` },
    timeout: 15_000,
  });

  return resp.data;
}

function isRateLimit1003(err) {
  const code = err?.response?.data?.code;
  const status = err?.response?.status;
  return code === -1003 || status === 429;
}

function shouldFailover(err) {
  // Failover on rate-limit, networking, timeouts, or 5xx
  if (isRateLimit1003(err)) return true;

  const status = err?.response?.status;
  if (!status) return true;               // no HTTP response => network/DNS/etc
  if (status >= 500) return true;         // Binance/server side
  if (status === 408) return true;         // timeout

  const code = err?.code;
  const netCodes = new Set([
    "ECONNABORTED",
    "ETIMEDOUT",
    "ECONNRESET",
    "ENOTFOUND",
    "EAI_AGAIN",
  ]);
  if (netCodes.has(code)) return true;

  return false; // e.g. 400/401/403 param/auth errors => do NOT failover
}

async function futuresFailoverSigned(method, endpoint, params, originalErr) {
  // IMPORTANT: do NOT send your secretKey/apiKey here
  // The failover server should sign using its own stored credentials.
  console.warn(
    `↪️  Failover: ${method} ${endpoint}`,
    originalErr?.response?.data || originalErr?.message || originalErr
  );

  const data = await callFailoverExec({
    provider: "binance-futures",
    signed: true,
    method,
    endpoint,
    params,
  });

  if (data == null) throw new Error("Failover returned null/empty response");
  return data;
}

async function futuresSignedRequestLocal(method, endpoint, params = {}) {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp }).toString();
  const signature = signRequest(query, process.env.secretKey);
  const url = `${BASE_FAPI_URL}${endpoint}?${query}&signature=${signature}`;

  const config = {
    method,
    url,
    headers: { "X-MBX-APIKEY": process.env.apiKey },
    // Binance signed futures endpoints usually take params in query-string; body is typically null
    data: null,
    timeout: 15_000,
  };

  const resp = await axios.request(config);
  return resp.data;
}

async function futuresSignedRequest(method, endpoint, params = {}) {
  try {
    return await futuresSignedRequestLocal(method, endpoint, params);
  } catch (err) {
    if (!shouldFailover(err)) throw err; // keep real errors visible (bad params, auth, etc.)

    // Try failover once
    try {
      return await futuresFailoverSigned(method, endpoint, params, err);
    } catch (failErr) {
      console.error(
        `❌ Failover also failed for ${method} ${endpoint}:`,
        failErr?.response?.data || failErr?.message || failErr
      );
      throw err; // throw original Binance error (most useful for debugging)
    }
  }
}

async function safeAsync(label, fn) {
  try {
    return await fn();
  } catch (e) {
    const details = e?.response?.data || e?.message || e;
    console.error(`⚠️ ${label} failed:`, details);
    return null;
  }
}

async function getPrice() {

  let Fprice = await getLatestPrice()
  return Fprice
}

function roundPrice(p) {
  return Number(p.toFixed(PRICE_PRECISION));
}

function roundQty(q) {
  return Number(q.toFixed(QTY_PRECISION));
}

// async function futuresDeleteSigned(endpoint, params = {}) {
//   const timestamp = Date.now();
//   const query = new URLSearchParams({ ...params, timestamp }).toString();
//   const signature = signRequest(query, process.env.secretKey);
//   const url = `${BASE_FAPI_URL}${endpoint}?${query}&signature=${signature}`;

//   const response = await axios.delete(url, {
//     headers: { 'X-MBX-APIKEY': process.env.apiKey },
//   });
//   return response.data;
// }

// type: "BUY" (long) or "SELL" (short)
// entryPrice: executed entry
// quantity: total position size in units (BNB, SOL, etc.)
// tpPct: full TP as decimal (e.g. 0.0085 = 0.85%)
// slPct: SL as decimal
// partialFraction: part of position to close at partial TP (0.5 = 50%)
async function placeBracketOrders(type, entryPrice, quantity, tpPct, slPct, partialFraction = 0.5) {
  const side = type === "BUY" ? "SELL" : "BUY"; // TPs/SL are opposite side

  const fullQty = Math.abs(quantity);
  const partialQty = roundQty(fullQty * partialFraction);
  const finalQty = roundQty(fullQty - partialQty);

  if (!partialQty || !finalQty) {
    console.log("⚠️ placeBracketOrders: qtys too small", { fullQty, partialQty, finalQty });
    return;
  }

  // Full TP price (e.g. 0.85% from entry)
  const tpPrice = type === "BUY"
    ? entryPrice * (1 + tpPct)
    : entryPrice * (1 - tpPct);

  // Partial TP — here I set it at 30% of full TP distance (same as your code).

  const partialTPPrice = type === "BUY"
    ? entryPrice * (1 + tpPct * partialLevelPct)
    : entryPrice * (1 - tpPct * partialLevelPct);

  const partialOrder = {
    symbol,
    side,
    type: "LIMIT",
    timeInForce: "GTC",
    quantity: partialQty,
    price: roundPrice(partialTPPrice),
    reduceOnly: true,
  };

  const finalOrder = {
    symbol,
    side,
    type: "LIMIT",
    timeInForce: "GTC",
    quantity: finalQty,
    price: roundPrice(tpPrice),
    reduceOnly: true,
  };

  const slStopPrice = type === "BUY"
    ? entryPrice * (1 - slPct)
    : entryPrice * (1 + slPct);

  const slOrder = {
    algoType: "CONDITIONAL",
    symbol,
    side,
    type: "STOP_MARKET",
    triggerprice: roundPrice(slStopPrice),
    closePosition: true,
    workingType: "MARK_PRICE",
    timestamp: new Date().toISOString()
  };

  console.log("📌 Placing partial TP:", partialOrder);
  const partialResp = await futuresPostSigned("/fapi/v1/order", partialOrder);

  console.log("📌 Placing final TP:", finalOrder);
  const finalResp = await futuresPostSigned("/fapi/v1/order", finalOrder);

  console.log("🛑 Placing SL (STOP_MARKET):", slOrder);
  const slResp = await futuresPlaceStopMarket(slOrder);

  return {
    partialTpOrderId: partialResp?.orderId,
    finalTpOrderId: finalResp?.orderId,
    slOrderId: slResp?.clientAlgoId,
  };
}


const isNum = v => typeof v === "number" && Number.isFinite(v);

// p in [0, 100], array must be sorted ascending
function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const w = idx - lo;
  return sortedArr[lo] * (1 - w) + sortedArr[hi] * w;
}

/**
 * Given all trades in one combo (filtered),
 * compute:
 *  - winners' MFE% percentiles: P20, P30, P50, P70
 *  - winners' MAE% percentiles: P60, P70
 *  - losers' MAE% percentiles: P40, P50
 * And suggest:
 *  - TP1 ≈ P30 of winners' MFE% (we'll use only TP1 for now)
 *  - SL  ≈ P70 of winners' MAE%
 */
function computeExitStatsForCombo(tradesSubset) {
  if (!tradesSubset || tradesSubset.length === 0) return null;

  const winners = tradesSubset.filter(t => t.profit > 0);
  const losers = tradesSubset.filter(t => t.profit <= 0);

  const mfeW = winners
    .map(t => t.mfePercent)
    .filter(isNum)
    .sort((a, b) => a - b);

  const maeW = winners
    .map(t => t.maePercent)
    .filter(isNum)
    .sort((a, b) => a - b);

  const maeL = losers
    .map(t => t.maePercent)
    .filter(isNum)
    .sort((a, b) => a - b);

  if (!mfeW.length) return null; // no MFE data → skip

  // Winners' MFE% percentiles
  const mfeP20 = percentile(mfeW, 20);
  const mfeP35 = percentile(mfeW, 35);
  const mfeP50 = percentile(mfeW, 50);
  const mfeP85 = percentile(mfeW, 85);

  // Winners' MAE% (may be empty if no winners)
  const maeW_P60 = maeW.length ? percentile(maeW, 60) : null;
  const maeW_P85 = maeW.length ? percentile(maeW, 85) : null;

  // Losers' MAE%
  const maeL_P40 = maeL.length ? percentile(maeL, 40) : null;
  const maeL_P50 = maeL.length ? percentile(maeL, 50) : null;

  // Suggested levels (in % units, e.g., 0.85 means 0.85%)
  const suggestedTP1 = mfeP35;   // TP1 ~ P30 of winners' MFE%
  const suggestedSL = maeW_P85; // SL  ~ P70 of winners' MAE%

  return {
    mfePercentiles: { mfeP20, mfeP35, mfeP50, mfeP85 },
    maeWPercentiles: { maeW_P60, maeW_P85 },
    maeLPercentiles: { maeL_P40, maeL_P50 },
    suggestedTP1,
    suggestedSL,
  };
}

function generateDynamicATRRanges(tradesData) {

  // Calculate ATR% for each trade
  const tradesWithATRPct = tradesData
    .filter(t => t.atr && t.entryPrice && !isNaN(t.atr) && !isNaN(t.entryPrice) && t.entryPrice > 0)
    .map(t => ({
      ...t,
      atrPct: t.atr / t.entryPrice // ATR as percentage of price
    }));

  if (tradesWithATRPct.length === 0) {
    console.warn("No valid ATR/Price data found");
    return [];
  }

  const atrPctValues = tradesWithATRPct.map(t => t.atrPct);
  const minPct = Math.min(...atrPctValues);
  const maxPct = Math.max(...atrPctValues);

  // Create price brackets based on data distribution
  const priceBrackets = [
    { name: "Low Price", min: 0, max: 10, trades: [] },
    { name: "Medium Price", min: 10, max: 100, trades: [] },
    { name: "High Price", min: 100, max: 1000, trades: [] },
    { name: "Very High Price", min: 1000, max: Infinity, trades: [] }
  ];

  // Categorize trades by price brackets
  tradesWithATRPct.forEach(trade => {
    const bracket = priceBrackets.find(b => trade.entryPrice >= b.min && trade.entryPrice < b.max);
    if (bracket) bracket.trades.push(trade);
  });

  // Generate ATR% ranges based on data distribution
  const sortedPctValues = [...atrPctValues].sort((a, b) => a - b);
  const getPercentile = (p) => {
    const index = Math.floor((p / 100) * sortedPctValues.length);
    return sortedPctValues[Math.min(index, sortedPctValues.length - 1)];
  };

  const p10 = getPercentile(10);
  const p25 = getPercentile(25);
  const p50 = getPercentile(50);
  const p75 = getPercentile(75);
  const p90 = getPercentile(90);

  // Generate ATR% ranges using multiple strategies
  const atrPctRanges = [];

  // Strategy 1: Fixed percentage ranges with finer steps for 4-decimal precision
  const fixedSteps = [0.0001, 0.00025, 0.0005, 0.001, 0.002, 0.003, 0.005]; // 0.01%, 0.025%, 0.05%, 0.1%, 0.2%, 0.3%, 0.5%
  fixedSteps.forEach(step => {
    for (let start = minPct; start <= maxPct; start += step) {
      const end = Math.min(start + step * 2, maxPct);
      atrPctRanges.push([start, end]);
    }
  });

  // Strategy 2: Percentile-based ranges
  const percentilePoints = [p10, p25, p50, p75, p90];
  for (let i = 0; i < percentilePoints.length; i++) {
    for (let j = i + 1; j < percentilePoints.length; j++) {
      atrPctRanges.push([percentilePoints[i], percentilePoints[j]]);
    }
  }

  // Strategy 3: Adaptive ranges based on density with finer granularity
  const adaptiveRanges = [];
  const numBuckets = 50; // Increased for finer granularity
  const bucketSize = (maxPct - minPct) / numBuckets;

  for (let i = 0; i < numBuckets; i++) {
    const start = minPct + (i * bucketSize);
    for (let j = i + 1; j < Math.min(i + 8, numBuckets); j++) { // Increased range combinations
      const end = minPct + (j * bucketSize);
      adaptiveRanges.push([start, end]);
    }
  }
  atrPctRanges.push(...adaptiveRanges);

  // Remove duplicates and filter valid ranges
  const uniquePctRanges = [...new Set(
    atrPctRanges
      .filter(([min, max]) => min < max && min >= 0)
      .map(r => JSON.stringify(r))
  )].map(r => JSON.parse(r));

  // Convert ATR% ranges to absolute ATR ranges for each price bracket
  const absoluteRanges = [];

  priceBrackets.forEach(bracket => {
    if (bracket.trades.length === 0) return;

    // Use median price of bracket for calculations
    const sortedTrades = bracket.trades.sort((a, b) => a.entryPrice - b.entryPrice);
    const medianPrice = sortedTrades[Math.floor(sortedTrades.length / 2)].entryPrice;

    uniquePctRanges.forEach(([minPct, maxPct]) => {
      const minATR = minPct * medianPrice;
      const maxATR = maxPct * medianPrice;

      // Only add ranges that make sense for this price level
      // Adjusted minimum for 4-decimal precision
      if (minATR >= 0.0001 && maxATR <= medianPrice * 0.1) { // Max 10% of price
        absoluteRanges.push({
          priceRange: bracket.name,
          priceMin: bracket.min,
          priceMax: bracket.max,
          atrMin: parseFloat(minATR.toFixed(4)), // Keep 4 decimal places
          atrMax: parseFloat(maxATR.toFixed(4)), // Keep 4 decimal places
          atrPctMin: minPct,
          atrPctMax: maxPct
        });
      }
    });
  });

  // Group and sort ranges by price bracket
  const rangesByPriceBracket = {};
  absoluteRanges.forEach(range => {
    if (!rangesByPriceBracket[range.priceRange]) {
      rangesByPriceBracket[range.priceRange] = [];
    }
    rangesByPriceBracket[range.priceRange].push([range.atrMin, range.atrMax]);
  });

  Object.entries(rangesByPriceBracket).forEach(([bracketName, ranges]) => {
    ranges.slice(0, 5).forEach(([min, max]) => {
      const bracket = priceBrackets.find(b => b.name === bracketName);
      const avgPrice = bracket.trades.length > 0
        ? bracket.trades.reduce((sum, t) => sum + t.entryPrice, 0) / bracket.trades.length
        : (bracket.min + bracket.max) / 2;

      const minPct = (min / avgPrice * 100).toFixed(4);
      const maxPct = (max / avgPrice * 100).toFixed(4);

    });
  });

  // Flatten all ranges into a single array for compatibility
  const allRanges = Object.values(rangesByPriceBracket).flat();

  // Remove duplicates and sort while maintaining 4 decimal precision
  const finalRanges = [...new Set(
    allRanges
      .map(r => JSON.stringify(r))
  )].map(r => JSON.parse(r))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .slice(0, 200); // Increased limit for more comprehensive ranges

  return finalRanges;
}

async function findBestATRCombo() {
  try {
    console.log("🔍 Running Raw ATR Optimizer...");

    // 1. Fetch all trades
    const res = await axios.get(
      `${process.env.backendURL}/bot/all-trades`,
      { headers: { Authorization: `Bearer A.saboor786` } }
    );

    let trades = res.data || [];

    // 2. Filter out invalid trades (bad dates)
    trades = trades.filter(t => {
      if (!t.time) return false;
      const ts = new Date(t.time).getTime();
      return !isNaN(ts);
    });

    // 3. Keep only last X days
    const now = Date.now();
    const xDaysAgo = now - OPTIMIZER_DAYS * 24 * 60 * 60 * 1000;

    trades = trades.filter(t => {
      const ts = new Date(t.time).getTime();
      return ts >= xDaysAgo;
    });

    console.log(`📊 Trades in last ${OPTIMIZER_DAYS} days: ${trades.length}`);

    if (trades.length < MIN_TRADES_FOR_DATASET) {
      console.warn(
        `⚠️ Not enough trades (${trades.length}) for optimization. Need at least ${MIN_TRADES_FOR_DATASET}.`
      );
      return null;
    }

    // 4. Convert string fields to numbers
    trades = trades.map(t => ({
      ...t,
      atr: typeof t.atr === "string" ? parseFloat(t.atr) : t.atr,
      entryPrice:
        typeof t.entryPrice === "string"
          ? parseFloat(t.entryPrice)
          : t.entryPrice,
      profit:
        typeof t.profit === "string" ? parseFloat(t.profit) : t.profit,
      slope: typeof t.slope === "string" ? parseFloat(t.slope) : t.slope,

      // NEW: MFE/MAE from history
      mfe: typeof t.mfe === "string" ? parseFloat(t.mfe) : t.mfe,
      mae: typeof t.mae === "string" ? parseFloat(t.mae) : t.mae,
      mfePercent:
        typeof t.mfePercent === "string" ? parseFloat(t.mfePercent) : t.mfePercent,
      maePercent:
        typeof t.maePercent === "string" ? parseFloat(t.maePercent) : t.maePercent,
    }));

    // 5. Get valid ATR values
    const atrValues = trades
      .map(t => t.atr)
      .filter(v => isFinite(v) && v > 0);

    if (atrValues.length === 0) {
      console.warn("⚠️ No valid ATR values found.");
      return null;
    }

    const minATR = Math.min(...atrValues);
    const maxATR = Math.max(...atrValues);

    console.log(
      `📈 ATR Range in data: ${minATR.toFixed(3)} - ${maxATR.toFixed(3)}`
    );

    const atrRanges = generateDynamicATRRanges(trades);

    // 7. Filter helpers
    const nyFilter = t => {
      const date = new Date(t.time);
      const utcHour = date.getUTCHours();
      return utcHour >= 15 && utcHour < 22; // 15–22 UTC ≈ NY session
    };

    const weekendFilter = t => {
      const d = new Date(t.time).getUTCDay();
      // return true for weekdays (Mon–Fri)
      return d !== 0 && d !== 6;
    };

    const nonZeroSlope = t => t.slope !== 0;

    const calculateWinrate = list => {
      const wins = list.filter(t => t.profit > 0).length;
      const total = list.length;
      return total > 0 ? (wins / total) * 100 : 0;
    };

    // 8. Evaluate all combos
    const useNYOptions = [true, false];
    const useWeekendOptions = [true, false]; // true = filter to weekdays
    const useSlopeOptions = [true, false];

    let allCombos = []; // structured combos for the bot
    let highWRCombos = []; // for logging
    let allATRCombos = []; // for logging

    for (let [minATRRange, maxATRRange] of atrRanges) {
      for (let useNY of useNYOptions) {
        for (let useWeekend of useWeekendOptions) {
          for (let useSlope of useSlopeOptions) {
            let filtered = trades.filter(
              t => t.atr >= minATRRange && t.atr <= maxATRRange
            );

            if (useNY) filtered = filtered.filter(nyFilter);
            if (useWeekend) filtered = filtered.filter(weekendFilter);
            if (useSlope) filtered = filtered.filter(nonZeroSlope);

            if (filtered.length === 0) continue;

            const wr = calculateWinrate(filtered);
            const totalProfit = filtered.reduce(
              (sum, t) => sum + (t.profit || 0),
              0
            );

            // ---------- SLOPE RANGE STATS (same logic as in Logs) ----------
            const slopeValues = filtered
              .map(t => t.slope)
              .filter(s => typeof s === "number" && !Number.isNaN(s));

            const slopeCount = slopeValues.length;
            const minSlope = slopeCount > 0 ? Math.min(...slopeValues) : null;
            const maxSlope = slopeCount > 0 ? Math.max(...slopeValues) : null;
            // ---------------------------------------------------------------

            const exitStats = computeExitStatsForCombo(filtered);

            // Convert % → decimal for bot:
            // e.g., suggestedTP1 = 0.85 → tpPctDec = 0.0085
            const tpPctDec = exitStats?.suggestedTP1 != null
              ? exitStats.suggestedTP1 / 100
              : null;

            const slPctDec = exitStats?.suggestedSL != null
              ? exitStats.suggestedSL / 100
              : null;

            // Combo format for internal bot logic
            const combo = {
              atrMin: minATRRange,
              atrMax: maxATRRange,
              useNY,
              useWeekend,
              useSlope,
              winrate: wr,
              trades: filtered.length,
              profit: totalProfit,

              slopeMin: minSlope,
              slopeMax: maxSlope,

              // NEW: TP/SL decimals (e.g. 0.0085 = 0.85%)
              tpPctDec,
              slPctDec,
            };

            allCombos.push(combo);

            // --- Logging-oriented combo (for console.table) ---
            const displayCombo = {
              ATR: `${minATRRange.toFixed(4)} - ${maxATRRange.toFixed(4)}`,
              NY: useNY,
              Weekend: useWeekend,
              SlopeFilter: useSlope,
              Winrate: wr.toFixed(2),
              Trades: filtered.length,
              Profit: totalProfit,
              SlopeMin: minSlope,
              SlopeMax: maxSlope,

              TP1_Pct: tpPctDec != null ? (tpPctDec * 100).toFixed(3) + "%" : null,
              SL_Pct: slPctDec != null ? (slPctDec * 100).toFixed(3) + "%" : null,
            };

            allATRCombos.push(displayCombo);

            // high‑WR list for logs (uses MIN_TRADES_ATR & MIN_WR_ATR)
            if (filtered.length >= MIN_TRADES_ATR && wr >= MIN_WR_ATR) {
              highWRCombos.push(displayCombo);
            }
          }
        }
      }
    }

    console.log("ATR combos with ANY trades:", allATRCombos.length);
    console.log(
      "ATR combos meeting thresholds:",
      highWRCombos.length
    );

    const sortDisplayCombos = arr => {
      arr.sort((a, b) => {
        const wrDiff = parseFloat(b.Winrate) - parseFloat(a.Winrate);
        if (wrDiff !== 0) return wrDiff;
        const profitDiff = b.Profit - a.Profit;
        if (profitDiff !== 0) return profitDiff;
        return b.Trades - a.Trades;
      });
    };

    if (highWRCombos.length > 0) {
      sortDisplayCombos(highWRCombos);
      console.log("==== HIGH WR COMBOS (Raw ATR) ====");
      console.table(highWRCombos.slice(0, 5));
    } else {
      // Still show best available combos for analysis, but don't use them for trading
      sortDisplayCombos(allATRCombos);
      console.log("==== BEST AVAILABLE COMBOS (FOR ANALYSIS ONLY - DO NOT TRADE) ====");
      console.table(allATRCombos.slice(0, 5));
    }

    if (allCombos.length === 0) {
      console.warn("⚠️ No valid combos for optimizer.");
      return null;
    }

    // ---------- HARD FILTER FOR BOT: ENFORCE BOTH MIN_TRADES_ATR AND MIN_WR_ATR ----------

    // 1) Filter combos that meet BOTH minimum trades AND minimum winrate
    const combosMeetingAllThresholds = allCombos.filter(
      c =>
        c.trades >= MIN_TRADES_ATR &&
        c.winrate >= MIN_WR_ATR &&
        typeof c.tpPctDec === "number" // require MFE‑based TP
    );
    // 2) If NO combos meet both thresholds, the optimizer fails. Return null to block trades.
    if (combosMeetingAllThresholds.length === 0) {
      console.warn(
        `🚨 CRITICAL: No ATR combos found with at least ${MIN_TRADES_ATR} trades AND a winrate of ${MIN_WR_ATR}%+. ` +
        `Optimizer will return null and bot will block trades to enforce priority on performance.`
      );
      return null;
    }

    console.log(`✅ Found ${combosMeetingAllThresholds.length} combos meeting all thresholds (Trades >= ${MIN_TRADES_ATR} AND WR >= ${MIN_WR_ATR}%).`);

    combosMeetingAllThresholds.sort((a, b) => {
      const wrDiff = b.winrate - a.winrate;
      if (Math.abs(wrDiff) > 0.01) return wrDiff;

      const profitDiff = b.profit - a.profit;
      if (Math.abs(profitDiff) > 0.01) return profitDiff;

      return b.trades - a.trades;
    });

    let bestCombo = combosMeetingAllThresholds[0];

    // 🔧 Clamp SL to TP for the BEST combo only
    if (
      typeof bestCombo.tpPctDec === "number" &&
      typeof bestCombo.slPctDec === "number" &&
      bestCombo.slPctDec > bestCombo.tpPctDec
    ) {
      console.log(
        `🔧 Clamping BEST combo SL from ${(bestCombo.slPctDec * 100).toFixed(3)}% ` +
        `down to TP ${(bestCombo.tpPctDec * 100).toFixed(3)}%`
      );
      bestCombo.slPctDec = bestCombo.tpPctDec;
    }

    console.log("🏆 Best ATR Combo For Bot (meeting all thresholds):");
    console.log(
      `   ATR: ${bestCombo.atrMin.toFixed(3)} - ${bestCombo.atrMax.toFixed(3)}`
    );
    console.log(`   NY Session: ${bestCombo.useNY}`);
    console.log(`   Weekday Only: ${bestCombo.useWeekend}`);
    console.log(`   Require Slope: ${bestCombo.useSlope}`);
    console.log(`   Winrate: ${bestCombo.winrate.toFixed(2)}%`);
    console.log(`   Trades: ${bestCombo.trades}`);
    console.log(`   Profit: $${bestCombo.profit.toFixed(2)}`);

    if (typeof bestCombo.tpPctDec === "number") {
      console.log(
        `   TP1 (from MFE): ${(bestCombo.tpPctDec * 100).toFixed(3)}%`
      );
    }
    if (typeof bestCombo.slPctDec === "number") {
      console.log(
        `   SL  (from MAE): ${(bestCombo.slPctDec * 100).toFixed(3)}%`
      );
    }

    return bestCombo;
  } catch (err) {
    console.error("❌ Optimizer Error:", err.message);
    return null;
  }
}

async function getBestCombo() {

  console.log("🔄 Refreshing best combo...");
  let cachedBestCombo = await findBestATRCombo();

  return cachedBestCombo;
}

async function checkTradeConditions(atr, slope, emaPack) {
  const now = new Date();

  const lossCheck = await checkTwoConsecutiveLosses24h();
  if (lossCheck.block) {
    console.log(`❌ Trade blocked by loss streak filter: ${lossCheck.reason}`);
    return {
      allowed: false,
      reason: lossCheck.reason,
      atr
    };
  }

  const bestCombo = await getBestCombo();

  if (!bestCombo) {
    console.log("⚠️ No optimized combo available - using fallback (block all)");
    return { allowed: false, reason: "No combo found - fallback mode", atr };
  }

  // 1. ATR range
  if (atr < bestCombo.atrMin || atr > bestCombo.atrMax) {
    const reason = `ATR ${atr.toFixed(3)} outside optimized range [${bestCombo.atrMin.toFixed(3)} - ${bestCombo.atrMax.toFixed(3)}]`;
    console.log(`❌ Trade blocked: ${reason}`);
    return { allowed: false, reason, atr };
  }

  // --- EMA spread filter (dynamic) ---
  if (emaPack?.ema9 != null && emaPack?.ema21 != null && emaPack?.ema50 != null) {
    const mult = dynamicEmaSpreadMultFromCombo(atr, bestCombo, {
      low: 0.20,  // tune
      high: 0.10, // tune
    });

    const ok = hasEnoughEMASpread(
      { ema9: emaPack.ema9, ema21: emaPack.ema21, ema50: emaPack.ema50 },
      atr,
      mult
    );

    if (!ok) {
      const minAbs = mult * atr;
      const d1 = Math.abs(emaPack.ema9 - emaPack.ema21);
      const d2 = Math.abs(emaPack.ema21 - emaPack.ema50);

      const reason =
        `EMA spread too tight: need > ${minAbs.toFixed(6)} ` +
        `(mult=${mult.toFixed(3)} of ATR=${atr.toFixed(6)}). ` +
        `|9-21|=${d1.toFixed(6)} |21-50|=${d2.toFixed(6)}`;

      console.log(`❌ Trade blocked: ${reason}`);
      return { allowed: false, reason, atr, slope };
    }
  } else {
    console.log("⚠️ EMA spread check skipped: emaPack missing");
  }

  // 2. NY session
  if (bestCombo.useNY) {
    const utcHour = now.getUTCHours();
    const isNYSession = utcHour >= 15 && utcHour < 22;
    if (!isNYSession) {
      const reason = `Not in NY session (UTC hour: ${utcHour}) - combo requires NY session`;
      console.log(`❌ Trade blocked: ${reason}`);
      return { allowed: false, reason, atr };
    }
  }

  // 3. Weekday only
  if (bestCombo.useWeekend) {
    const dayUTC = now.getUTCDay();
    if (dayUTC === 0 || dayUTC === 6) {
      const reason = `Weekend trading disabled by optimized combo`;
      console.log(`❌ Trade blocked: ${reason}`);
      return { allowed: false, reason, atr };
    }
  }

  // 4. Slope
  // 4. Slope
  if (bestCombo.useSlope) {
    // First enforce non-zero slope (your existing condition)
    if (slope === 0) {
      const reason = `Slope is 0 - combo requires non-zero slope`;
      console.log(`❌ Trade blocked: ${reason}`);
      return { allowed: false, reason, atr, slope };
    }

    // Then enforce slope range, if optimizer computed it
    if (
      typeof bestCombo.slopeMin === "number" &&
      typeof bestCombo.slopeMax === "number"
    ) {
      if (slope < bestCombo.slopeMin || slope > bestCombo.slopeMax) {
        const reason = `Slope ${slope.toFixed(4)} outside optimized range ` +
          `[${bestCombo.slopeMin.toFixed(4)} - ${bestCombo.slopeMax.toFixed(4)}]`;
        console.log(`❌ Trade blocked: ${reason}`);
        return { allowed: false, reason, atr, slope };
      }
    }
  }

  console.log(`✅ Trade conditions passed (Optimized Combo):`);
  console.log(
    `   ATR: ${atr.toFixed(3)} [Range: ${bestCombo.atrMin.toFixed(3)} - ${bestCombo.atrMax.toFixed(3)}]`
  );

  if (
    typeof bestCombo.slopeMin === "number" &&
    typeof bestCombo.slopeMax === "number"
  ) {
    console.log(
      `   Slope: ${slope.toFixed(4)} [Range: ${bestCombo.slopeMin.toFixed(4)} - ${bestCombo.slopeMax.toFixed(4)}]`
    );
  }

  console.log(`   Combo WR: ${bestCombo.winrate.toFixed(2)}%`);

  return { allowed: true, reason: "All optimized conditions passed", atr };
}

async function calculateMFEandMAE(entryPrice, entryTimestamp, type) {
  // MFE = Maximum Favourable Movement (using candle CLOSE)
  // MAE = Maximum Adverse Excursion (using candle CLOSE)

  try {
    if (!Array.isArray(tradeCandleCloses) || tradeCandleCloses.length === 0) {
      console.log("⚠️ No candle data to calculate MFE/MAE");
      return null;
    }

    // Extract numeric closes from candle objects
    const closes = tradeCandleCloses
      .map(c => Number(c?.close))
      .filter(Number.isFinite);

    if (closes.length === 0) {
      console.log("⚠️ Candle array exists but no valid close values");
      return null;
    }

    // Find highest and lowest close prices
    const maxClose = Math.max(...closes);
    const minClose = Math.min(...closes);

    let mfe = 0, mae = 0;

    if (type === "BUY") {
      // For BUY: MFE = highest close above entry, MAE = lowest close below entry
      mfe = (maxClose - entryPrice) / entryPrice;
      mae = (entryPrice - minClose) / entryPrice;
    } else if (type === "SELL") {
      // For SELL: MFE = lowest close below entry, MAE = highest close above entry
      mfe = (entryPrice - minClose) / entryPrice;
      mae = (maxClose - entryPrice) / entryPrice;
    }

    // Ensure MFE and MAE are not negative
    mfe = Math.max(mfe, 0);
    mae = Math.max(mae, 0);

    return {
      mfe: parseFloat(mfe.toFixed(6)), // decimal (e.g., 0.0035 = 0.35%)
      mae: parseFloat(mae.toFixed(6)),
      mfePercent: (mfe * 100).toFixed(3),
      maePercent: (mae * 100).toFixed(3),
      maxClose,
      minClose
    };

  } catch (err) {
    console.error("Error calculating MFE/MAE:", err.message);
    return null;
  }
}

async function checkTwoConsecutiveLosses24h() {
  try {
    const res = await axios.get(
      `${mainBotUrl}/bot/real-history`,
      { headers: { Authorization: `Bearer A.saboor786` } }
    );

    let trades = res.data || [];

    // only trades with valid time
    trades = trades.filter(t => t.time && !isNaN(new Date(t.time).getTime()));

    if (trades.length < 2) {
      return { block: false };
    }

    // sort latest → oldest
    trades.sort((a, b) => new Date(b.time) - new Date(a.time));

    const last1 = trades[0];
    const last2 = trades[1];

    const p1 = parseFloat(last1.profit);
    const p2 = parseFloat(last2.profit);

    console.log(`P1 = ${p1}. P2 = ${p2}`);

    const isLoss1 = !isNaN(p1) && p1 < 0;
    const isLoss2 = !isNaN(p2) && p2 < 0;

    if (!(isLoss1 && isLoss2)) {
      // last two trades are not both losses
      return { block: false };
    }

    // if last loss is within last 24h, we are in cooldown
    const lastLossTs = new Date(last2.time).getTime();
    const now = Date.now();
    const twentyFourHrs = 24 * 60 * 60 * 1000;

    if (now - lastLossTs <= twentyFourHrs) {
      const cooldownEnd = new Date(lastLossTs + twentyFourHrs).toISOString();
      console.log(`Cooldown Until ${cooldownEnd}`);
      return {
        block: true,
        reason: `2 consecutive losses, cooldown active until ${cooldownEnd}`
      };
    }

    // last two losses are older than 24h → no block
    return { block: false };

  } catch (err) {
    console.error("❌ Error in checkTwoConsecutiveLosses24h:", err.message);
    // safer choice: do NOT block on error (change to block:true if you prefer)
    return { block: false };
  }
}

async function calculateEmaSignal() {
  try {

    const { ohlcv, status } = await getLatestCandle();

    if (status === 0 || !ohlcv || ohlcv.length < 60) {
      return { status: 0, msg: "Insufficient or invalid data" };
    }
    const data = ohlcv.map(c => c.closes);

    if (!Array.isArray(data) || data.length < 60) {
      console.error("❌ EMA error: Invalid or missing candle data");
      return { status: 0, msg: "Invalid or insufficient candle data" };
    }

    const ema9 = EMA.calculate({ period: 5, values: data });
    const ema21 = EMA.calculate({ period: 13, values: data });
    const ema50 = EMA.calculate({ period: 34, values: data });
    const ema200 = EMA.calculate({ period: 89, values: data });

    const last9 = ema9[ema9.length - 1];
    const last21 = ema21[ema21.length - 1];
    const last50 = ema50[ema50.length - 1];
    const last200 = ema200[ema200.length - 1];

    let signal = "WAIT"; // Try to Remove the Wait
    if (last9 > last21 && last21 > last50 && last50 > last200) {
      signal = "BUY";
    } else if (last9 < last21 && last21 < last50 && last50 < last200) {
      signal = "SELL";
    }

    return {
      status: 1,
      msg: {
        ema9: last9,
        ema21: last21,
        ema50: last50,
        ema200: last200,
        signal
      }
    }
  }
  catch (err) {
    console.log({ status: 0, msg: err.message });

  }

}




// Track sent times to avoid duplicate sends
let lastSent = {
  "10:00": null,
  "13:00": null,
  "16:00": null,
  "19:00": null
};

const allowedDays = [1, 2, 3, 4, 5, 6]; // NO SUNDAY


function saveSubscription(subscription) {
  subscriptions.push(subscription);
  console.log(subscription);
}

function updateEMA(emaNow) {
  emaHistory.push(emaNow);   // 1. Add the latest EMA value to the array

  // 2. Keep array size fixed (only last 10 values)
  if (emaHistory.length > 10) {
    emaHistory.shift();  // Removes the oldest value (first element of the array)
  }
}



function setLastTradeSignal(signal) {
  lastTradeSignal = signal;
}

function setLiveTradeCtx(liveTradeCtxFromDb) {
  liveTradeCtx = liveTradeCtxFromDb;
}

function updLastSignal(newSignal) {
  lastSignal = newSignal;
}

function SetLastDetails(signal, time, price, objectId) {
  prevTradeType = signal;
  prevTradeTime = time;
  prevTradePrice = price;
  prevTradeObjectId = objectId ? objectId : null;
}

async function updateBotStatus(active, signal, inTrade) {
  try {
    await axios.post(`${process.env.backendURL}/bot/status`, { // WebUrl Here
      isActive: active,
      lastSignal: signal,
      inTrade: inTrade
    },
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      });
  } catch (err) {
    console.error("Failed to update bot status:", err.message);
  }
}

async function updateLastTrade(lastTradeSignal, LastTradeTime, lastTradePrice, lastTradeObjectId) {
  try {
    await axios.post(`${process.env.backendURL}/bot/save-last`, { // WebUrl Here

      lastTradeSignal: lastTradeSignal ? lastTradeSignal : null,
      LastTradeTime: LastTradeTime ? LastTradeTime : null,
      lastTradePrice: lastTradePrice ? lastTradePrice : null,
      lastTradeObjectId: lastTradeObjectId ? lastTradeObjectId : null
    },
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      });


  } catch (err) {
    console.error("Failed to update Last Trade:", err.message);
  }

}

function setTradeCandles(candles) {
  tradeCandleCloses = candles;

}

function updatePartial(value, slOrder) {
  partialTPHit = value;
  activeSlOrderId = slOrder;
  console.log("Update Partial is Set to True!");
}

async function getCandlesFromDb() {
  try {
    const response = await axios.get(
      `${process.env.backendURL}/bot/trade-candles`,
      {
        headers: { Authorization: `Bearer A.saboor786` }
      }
    );

    if (response.data.success) {
      console.log(`📊 Retrieved ${response.data.totalCandles} candles from DB`);
      return response.data.candleCloses;
    }

    return [];
  } catch (err) {
    console.error("❌ Failed to get candles from DB:", err.message);
    return [];
  }
}

async function addCandleCloseToDb(candle) {
  try {
    if (!candle) return null;

    const response = await axios.post(
      `${process.env.backendURL}/bot/trade-candles`,
      { candle },   // ✅ send candle object
      { headers: { Authorization: `Bearer A.saboor786` } }
    );

    return response.data;
  } catch (err) {
    console.error("❌ Failed to add candle to DB:", err.message);
    return null;
  }
}

// Append one OHLCV candle to DB
async function appendCandleToDb(candle, interval = '3m') {
  try {
    if (!candle || typeof candle.openTime !== 'number' || typeof candle.closeTime !== 'number') {
      return null;
    }

    const resp = await axios.post(
      `${process.env.backendURL}/bot/candles-data`,
      { interval, candle },
      { headers: { Authorization: `Bearer A.saboor786` } }
    );

    return resp.data;
  } catch (err) {
    console.error("❌ Failed to append candle to CandlesData in DB:", err);
    return null;
  }
}

async function clearCandlesDataInDb(interval = '3m') {
  try {
    const resp = await axios.delete(
      `${process.env.backendURL}/bot/candles-data`,
      {
        params: { interval },
        headers: { Authorization: `Bearer A.saboor786` }
      }
    );

    if (resp.data.success) {
      console.log("🧹 CandlesData cleared from DB");
      return true;
    }

    return false;
  } catch (err) {
    console.error("❌ Failed to clear CandlesData in DB:", err.message);
    return false;
  }
}

async function clearCandlesInDb() {
  try {
    const response = await axios.delete(
      `${process.env.backendURL}/bot/trade-candles`,
      {
        headers: { Authorization: `Bearer A.saboor786` }
      }
    );

    if (response.data.success) {
      console.log("🧹 trade-candles cleared in DB");
      return true;
    }

    console.log("⚠️ clearCandlesInDb: backend responded but success=false:", response.data);
    return false;
  } catch (err) {
    console.error("❌ Failed to clear trade-candles in DB:", err.response?.data || err.message);
    return false;
  }
}

async function getBotStatusFromDB() {
  try {
    const res = await axios.get(`${process.env.backendURL}/bot/status`,
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      }); // WebUrl here
    return res.data;
  } catch (err) {
    console.error("Failed to fetch bot status from DB:", err.message);
    return { lastTradeSignal: null, LastTradeTime: null, lastTradePrice: null, lastTradeObjectId: null };
  }
}

async function getLastTradeFromDB() {
  try {
    const res = await axios.get(`${process.env.backendURL}/bot/get-last`,
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      }); // WebUrl here
    return res.data;
  } catch (err) {
    console.error("Failed to fetch Last Trade from DB:", err.message);
    return { isActive: false, lastSignal: null, inTrade: false };
  }
}

async function placeOrder(signal, ema200) {
  try {
    partialTPHit = false;  // reset for new trade
    liveTradeCtx = null;
    partialLockedSLPrice = null
    let leverage = 10
    let ids = null;

    const { data } = await axios.get(`${process.env.backendURL}/bot/atr`,
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      }); // WebUrl Here
    const { atr } = data;



    let emaNow = emaHistory[emaHistory.length - 1];   // latest
    let ema5ago = emaHistory[emaHistory.length - 5];
    let slope = (emaNow - ema5ago) / ema5ago

    if (!Number.isFinite(slope)) {
      console.warn("⚠️ Slope was NaN or invalid, setting to 0");
      slope = 0;
    }

    // const pctAway = Math.abs((LatestPrice - ema200) / ema200);

    console.log(`Slope is ${Math.abs(slope).toFixed(4)}`);
    console.log(`Atr is ${atr}`);


    const conditionCheck = await checkTradeConditions(atr, Number(Math.abs(slope).toFixed(4)), latestEmaPack);

    let orderExecuted = false;

    if (!conditionCheck || conditionCheck.allowed !== true) {

      console.log(`🚫 Order NOT placed for ${signal}: ${conditionCheck.reason}`);
    }
    else if (conditionCheck.allowed == true && LiveTrading && BinanceTrading) {

      try {
        await getBalance();
        await placeFuturesOrderWithDollarAmount(signal, currentBalance); // 2nd Arrgument is Position Size in $.
        orderExecuted = true;
      } catch (err) {
        console.log(err.msg);
      }

    }
    const entryPrice = await getPrice();

    if (conditionCheck.allowed == true) {
      // Get TP/SL from the same best combo used in conditions
      const bestCombo = await getBestCombo();
      const tpFromCombo = bestCombo?.tpPctDec;
      const slFromCombo = bestCombo?.slPctDec;

      // Use TP1 as the only TP for now; fall back to 0.6% if not available
      currentTP = typeof tpFromCombo === "number" ? tpFromCombo : atrMultToPctDec(atr, entryPrice, TP_ATR_MULT);

      // For SL you can either:
      //  - use MAE‑based slFromCombo, or
      //  - keep your old ATR‑based SL
      // Here we try MAE‑based, fallback to ATR * 2.5 (converted to % of entry):

      let defaultSlPct = atrMultToPctDec(atr, entryPrice, SL_ATR_MULT); // convert old ATR-based abs SL into %
      currentSL = typeof slFromCombo === "number" ? slFromCombo : defaultSlPct;

      if (SL_MATCH_PARTIAL) {
        const partialPctDec = partialPctFromTp(currentTP);
        currentSL = partialPctDec;
        console.log(
          `🔁 SL matched to partial distance: partial=${(partialPctDec * 100).toFixed(3)}% => SL=${(currentSL * 100).toFixed(3)}%`
        );
      }

      console.log(
        `Using TP=${(currentTP * 100).toFixed(3)}% and SL=${(currentSL * 100).toFixed(3)}% from best combo`
      );

    } else {
      currentSL = atrMultToPctDec(atr, entryPrice, SL_ATR_MULT);
      currentTP = atrMultToPctDec(atr, entryPrice, TP_ATR_MULT);
    }


    // --- Position size used for DB and bracket orders ---
    const positionSizeUSD = currentBalance;                    // same as you send to Binance
    const pairQuantity = Number((positionSizeUSD / entryPrice).toFixed(1)); // base asset qty

    // If we actually opened a futures position, place bracket orders on Binance

    if (orderExecuted && LiveTrading) { 
      await startUserStreamIfNeeded();

      if (BinanceTrading) {
        console.log(
          `🔧 Placing bracket: entry=${entryPrice}, qty=${pairQuantity}, ` +
          `TP=${(currentTP * 100).toFixed(3)}%, SL=${(currentSL * 100).toFixed(3)}%`
        );

        ids = await placeBracketOrders(
          signal,        // "BUY" or "SELL"
          entryPrice,
          pairQuantity,
          currentTP,     // decimal, e.g. 0.0085
          currentSL,     // decimal
          0.5            // 50% partial
        );

        activeSlOrderId = ids?.slOrderId;
      }

      liveTradeCtx = {
        symbol,
        type: signal,                 // "BUY" or "SELL"
        entryPrice,
        tpPctDec: currentTP,

        fullQty: pairQuantity,        // total position qty at entry
        fullUsd: positionSizeUSD,     // total notional you used

        tp1OrderId: ids?.partialTpOrderId,
        slClientAlgoId: ids?.slOrderId,
      };

      console.log("🎯 Armed UserData listener for TP1:", liveTradeCtx.tp1OrderId);


    }


    // ⏰ Pakistan time manually (UTC + 5)
    const pakTime = new Date(Date.now() + 5 * 60 * 60 * 1000);

    // ⏰ Get 3m candle timestamp
    const now = Date.now();
    const candleTimestamp = now - (now % (3 * 60 * 1000)); // <-- 🆕 This is the key

    console.log(`Order placed for: ${signal} at ${entryPrice} on ${new Date().toLocaleTimeString()}`);

    lastTradeSignal = signal;

    const fullTpPrice = signal === "BUY"
      ? entryPrice * (1 + currentTP)
      : entryPrice * (1 - currentTP);

    const partialTpPrice = signal === "BUY"
      ? entryPrice * (1 + currentTP * partialLevelPct)
      : entryPrice * (1 - currentTP * partialLevelPct);

    const slPrice = signal === "BUY"
      ? entryPrice * (1 - currentSL)
      : entryPrice * (1 + currentSL);


    await axios.post(`${process.env.backendURL}/bot/save-trade`, { // WebUrl Here
      signal: signal,
      time: pakTime.toISOString(), // Saved in ISO format but in PKT
      price: entryPrice,
      atr: atr,
      real: conditionCheck.allowed ? true : false,
      slope: Number(Math.abs(slope).toFixed(4)),
      positionSize: pairQuantity,
      positionSizeUSD: positionSizeUSD,
      leverage: leverage,
      candleTimestamp, // 🆕 New field
      tpPrice: fullTpPrice,
      partialTpPrice,
      slPrice,
      tpPctDec: currentTP,

      // NEW:
      slOrderId: ids?.slOrderId ?? null,
      tp1OrderId: ids?.partialTpOrderId ?? null,
      tp2OrderId: ids?.finalTpOrderId ?? null,
    },
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      });

    await updateBotStatus(true, signal, true); // now inTrade is true


    await updateLastTrade(signal, new Date().toISOString(), entryPrice)

    SetLastDetails(signal, new Date().toISOString(), entryPrice);

  }
  catch (err) {
    const msg = err?.response?.data?.msg || err.message || "Unknown error";
    console.error(`❌ Place Order Error: ${msg}`);
  }

}

async function getBalance() {

  axios.get('https://api.ipify.org?format=json')
    .then(res => {
      console.log('Public IP:', res.data.ip);
    })
    .catch(err => console.error(err));

  const balanceData = await futuresGetSigned('/fapi/v2/account');
  let availableBalance = parseFloat(balanceData.availableBalance);

  // Use 98% of available balance
  let usableBalance = availableBalance * 0.95;

  // Round down and ensure safe default for very high balances
  usableBalance = (usableBalance >= 100) ? 100 : usableBalance;

  currentBalance = Math.floor(usableBalance * 10);
  console.log(`✅ Current Futures Wallet Balance: $${currentBalance}`);

}


async function signalChanged(newSignal, restStatus, ema200) {

  const { inTrade } = await getBotStatusFromDB();

  console.log("Checking InTrade From DB inside SignalChanged :", inTrade);


  if (newSignal === "WAIT") {
    console.log(`Signal changed: ${lastSignal} → ${newSignal}`);
    lastSignal = newSignal;
    await updateBotStatus(true, newSignal, inTrade);

  } else if (!inTrade) {

    if (prevTradeObjectId && newSignal !== "WAIT") await handleMfeandMea(prevTradePrice, prevTradeTime, prevTradeType);

    console.log(`Signal changed: ${lastSignal} → ${newSignal}`);
    lastSignal = newSignal;
    await updateBotStatus(true, newSignal, inTrade);
    await placeOrder(newSignal, ema200);

  } else if (inTrade && newSignal != lastTradeSignal) {

    if (prevTradeObjectId && newSignal !== "WAIT") await handleMfeandMea(prevTradePrice, prevTradeTime, prevTradeType);

    await checkTPorSL(newSignal)
    console.log(`Signal changed: ${lastSignal} → ${newSignal}`);
    lastSignal = newSignal;
    await updateBotStatus(true, newSignal, inTrade);
    await placeOrder(newSignal);

  }
  else if (inTrade) {
    console.log(`Signal is ${newSignal}. But it is Already in Trade`);
    lastSignal = newSignal;
    await updateBotStatus(true, newSignal, inTrade);

    if (prevTradeObjectId && newSignal !== "WAIT") await handleMfeandMea(prevTradePrice, prevTradeTime, prevTradeType);

  }
}

async function addCandleClose(candle) {
  if (prevTradePrice !== null) {
    tradeCandleCloses.push(candle);
    await addCandleCloseToDb(candle);
    console.log(`📈 Candle close added: ${candle} (Total: ${tradeCandleCloses.length})`);
  }
}


async function handleMfeandMea(prevTradePrice, prevTradeTime, prevTradeType) {

  try {
    console.log(`Handle Mfe Running ✅`);

    const excursion = await calculateMFEandMAE(prevTradePrice, prevTradeTime, prevTradeType);

    await axios.post(
      `${process.env.backendURL}/bot/upd-history`,
      {
        tradeId: prevTradeObjectId, // from earlier save
        mfe: excursion.mfe,
        mae: excursion.mae,
        mfePercent: excursion.mfePercent,
        maePercent: excursion.maePercent,
        candlesData: tradeCandleCloses
      },
      {
        headers: { Authorization: `Bearer A.saboor786` }
      }
    );

    await updateLastTrade(null, null, null, null)
    SetLastDetails(null, null, null, null)
    await clearCandlesInDb();
    tradeCandleCloses = [];

  }
  catch (err) {
    const msg = err?.response?.data?.msg || err.message || "Unknown error";
    console.error(`❌ Handle MFE Error: ${msg}`);
  }

}

async function checkSignal() {

  try {
    let finalRest = false;

    let res = await calculateEmaSignal()
    latestEmaPack = res?.msg || null;
    const newSignal = latestEmaPack?.signal;
    const ema200 = parseFloat(res.msg.ema200.toFixed(4));
    updateEMA(ema200);

    const { ohlcv, status } = getLatestCandle();
    if (status === 1 && ohlcv && ohlcv.length > 0) {
      const last = ohlcv[ohlcv.length - 1];

      const candleForDb = {
        openTime: last.openTime,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.closes,  // note: schema uses "close"
        volume: last.volume,
        closeTime: last.closeTime,
      };

      await addCandleClose(candleForDb); // ✅ send normalized candle
      await appendCandleToDb(candleForDb, '3m');
    }


    if (newSignal == undefined) {

      console.log("Signal is Undefined. Error in Check Signal");

    } else if (newSignal !== lastSignal) {

      await signalChanged(newSignal, finalRest, ema200);
    }
    else {

      console.log(`Same signal: ${newSignal} at ${new Date().toLocaleTimeString()}`);

    }


    // Still check TP/SL in all cases
    await checkTPorSL(finalRest ? null : newSignal);
  }
  catch (err) {
    const msg = err?.response?.data?.msg || err.message || "Unknown error";
    console.error(`❌ Check Signal Error: ${msg}`);
  }

}

async function setTpSl(partialHit) {
  try {
    const resp = await axios.get(`${process.env.backendURL}/bot/get-trade`, {
      headers: { Authorization: `Bearer A.saboor786` }
    });
    const trade = resp?.data;
    const atr = trade?.atr;
    if (!trade || trade.entryPrice == null) {
      console.log("ℹ️ No active trade found to set TP/SL.");
      return { ok: false, msg: "no-trade" };
    }

    const entry = Number(trade.entryPrice);
    if (!Number.isFinite(entry) || entry <= 0) {
      console.error("❌ Invalid entryPrice in active trade:", trade.entryPrice);
      return { ok: false, msg: "bad-entry" };
    }

    const bestCombo = await getBestCombo();

    let tpPctDec = typeof bestCombo?.tpPctDec === "number"
      ? bestCombo.tpPctDec
      : atrMultToPctDec(atr, entry, TP_ATR_MULT); // 0.6%

    let defaultSlPct = atrMultToPctDec(atr, entry, SL_ATR_MULT);
    let slPctDec = typeof bestCombo?.slPctDec === "number"
      ? bestCombo.slPctDec
      : defaultSlPct;

    // Clamp here as well
    if (slPctDec > tpPctDec) slPctDec = tpPctDec;

    currentTP = tpPctDec;
    currentSL = partialHit ? 0 : slPctDec;

    console.log(
      `🎯 currentTP/currentSL set from best combo: ` +
      `TP=${(tpPctDec * 100).toFixed(3)}% SL=${(currentSL * 100).toFixed(3)}%`
    );

    return { ok: true, entryPrice: entry, tpPctDec, slPctDec };
  } catch (err) {
    if (err?.response?.status === 404) {
      console.log("ℹ️ No active trade (404) — TP/SL not set.");
      return { ok: false, msg: "no-trade" };
    }
    console.error("❌ setCurrentTPSLFromActiveTrade error:", err.message);
    return { ok: false, msg: "error" };
  }
}

async function startLoop() {

  // const info = await axios.get("https://fapi.binance.com/fapi/v1/exchangeInfo");
  // const sym = info.data.symbols.find(s => s.symbol === "BNBUSDT");
  // console.log(sym);

  // await checkTradeConditions(1.80, 0.0009);
  // await getBalance();

  // const beOrder = {
  //   algoType: "CONDITIONAL",
  //   symbol,
  //   side: "BUY",
  //   type: "STOP_MARKET",
  //   triggerprice: 615.50,
  //   closePosition: true,
  //   workingType: "MARK_PRICE",
  //   timestamp: new Date().toISOString()
  // };

  // // 1) Place BE stop first
  // const beResp = await safeAsync("Place BE STOP_MARKET", () =>
  //   futuresPlaceStopMarket(beOrder)
  // );

  // const newSlOrderId = beResp?.orderId ? String(beResp.orderId) : null;

  // console.log(newSlOrderId,beResp);

  // await safeAsync("Cancel old SL", () => CancelFuturesPlaceStopMarket( "PPNxcUPIcg9qqOsq1H7vc4"));

  intervalRef = setInterval(checkSignal, 1000 * 60 * 3);
  checkSignal(); // immediate first run
  console.log("Bot loop started.");
  // sendPushNotification("🤖 Bot has started trading!");
}

async function stopLoop() {
  try {
    clearInterval(intervalRef);
    SetLastDetails(null, null, null, null)
    intervalRef = null;
    lastSignal = null;
    lastTradeSignal = null;

    const res = await axios.get(`${process.env.backendURL}/bot/get-trade`,
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      });

    if (res?.data) {
      if (LiveTrading) await closePosition(symbol);
      await axios.post(`${process.env.backendURL}/bot/clear-trade`,
        {},
        {
          headers: {
            Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
          }
        });
      console.log("Trade cleared.");
    }

    await updateBotStatus(false, null, false);
    await updateLastTrade(null, null, null, null)
    await clearCandlesInDb();
    await clearCandlesDataInDb();
    tradeCandleCloses = [];

    console.log("Bot stopped.");

  } catch (err) {
    console.error("Error in stopLoop:", err.response?.status, err.message);
    await updateBotStatus(false, null, false);
    await updateLastTrade(null, null, null, null)
    await clearCandlesDataInDb();
    tradeCandleCloses = [];
    console.log("Bot force-stopped due to error.");
  }
}

async function isBotActive() {
  const { isActive } = await getBotStatusFromDB();
  return isActive;
}

async function initTradeCount() {
  const res = await axios.get(`${process.env.backendURL}/bot/last-trade`,
    {
      headers: {
        Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
      }
    });
  tradeCount = res.data.tradeNumber;
  console.log("✅ Trade count restored to:", tradeCount);
}

async function waitForNext3MinCandle() {

  console.log("⚙️  3min Function Running");

  const alreadyActive = await isBotActive();

  console.log("✅ Bot Active from DB:", alreadyActive);

  const res = await axios.get(`${process.env.backendURL}/bot/ema`,
    {
      headers: {
        Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
      }
    }); // WebUrl Here
  const newSignal = res.data.msg.signal;
  console.log("✅ Last Signal Registered");
  lastSignal = res.data.msg.signal // Updated the Local LastSignal


  await updateBotStatus(true, newSignal, false);
  console.log("✅ Bot marked active in DB");

  await initTradeCount();

  if (alreadyActive) {
    console.log("⛔ Bot is already active. Skipping start.");
    return;
  }

  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  const remainder = 3 - (minutes % 3);
  const delay = (remainder * 60 - seconds + 1) * 1000;

  console.log(`⏳ Waiting ${delay / 1000}s until next 3-min candle...`);

  setTimeout(async () => {
    console.log("⏰ Delay over — executing start");

    try {
      await initSymbolSettings();
      startLoop(); // should log "✅ startLoop triggered"
    } catch (err) {
      console.error("❌ Failed to start bot inside timeout:", err.message);
    }
  }, delay);
}

async function checkTPorSL(lastSignal) {
  try {

    const now = Date.now();
    const currentCandleTimestamp = now - (now % (3 * 60 * 1000));


    // Get the active trade data from the backend
    const tradeRes = await axios.get(`${process.env.backendURL}/bot/get-trade`,
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      }); // WebUrl here 
    let { entryPrice, type, positionSize, positionSizeUSD, leverage, atr, slope, candleTimestamp, real, realizedProfit, tpPrice, partialTpPrice, slPrice } = tradeRes.data;

    realizedProfit = Number(realizedProfit) || 0;

    console.log("Active Trade Found ✅");

    if (parseInt(candleTimestamp) === currentCandleTimestamp) {

      console.log("📛 Trade is still in entry candle — skipping SL/TP check");

    }
    else {

      // === Use LAST 3m CANDLE instead of tick price ===
      const { ohlcv, status } = getLatestCandle();
      if (!ohlcv || !ohlcv.length) {
        console.log("⚠️ No candles available for TP/SL check");
        return;
      }
      const lastCandle = ohlcv[ohlcv.length - 1];
      const high = lastCandle.high;
      const low = lastCandle.low;

      // Sanity
      if (!Number.isFinite(high) || !Number.isFinite(low)) {
        console.log("⚠️ Invalid high/low in last candle:", lastCandle);
        return;
      }

      // Compute TP / SL prices from entry + currentTP/currentSL
      const tp = type === "BUY"
        ? entryPrice * (1 + currentTP)
        : entryPrice * (1 - currentTP);

      let softSL = type === "BUY"
        ? entryPrice * (1 - currentSL)
        : entryPrice * (1 + currentSL);

      if (partialTPHit) {
        const lockProfitPct = currentTP * PARTIAL_LOCK_PCT_OF_TP; // 5% of TP distance

        // signed SL value so it moves into profit direction
        currentSL = -lockProfitPct;

        partialLockedSLPrice = type === "BUY"
          ? entryPrice * (1 - currentSL)
          : entryPrice * (1 + currentSL);

        softSL = partialLockedSLPrice;
      }

      console.log(
        `Entry=${entryPrice}, TP=${tp.toFixed(4)}, SL=${softSL.toFixed(4)}, ` +
        `high=${high}, low=${low}, TP%=${(currentTP * 100).toFixed(3)}%, SL%=${(currentSL * 100).toFixed(3)}%`
      );

      // ===== PARTIAL TP at 60% of TP =====

      const partialTPPrice = type === "BUY"
        ? entryPrice * (1 + currentTP * partialLevelPct)
        : entryPrice * (1 - currentTP * partialLevelPct);

      // Did this candle touch partial TP?
      const reachedPartial = type === "BUY"
        ? high >= partialTPPrice
        : low <= partialTPPrice;

      if (!partialTPHit && reachedPartial && real && LiveTrading) {
        console.log(`🎯 Candle hit partial TP (${partialTPPrice.toFixed(4)}). Taking 50%...`);

        // --- calc partial ---
        const fraction = 0.5;

        const profitPercentPartial =
          type === "BUY"
            ? (partialTPPrice - entryPrice) / entryPrice
            : (entryPrice - partialTPPrice) / entryPrice;

        const partialNotional = positionSizeUSD * fraction;
        let partialProfitDollars = profitPercentPartial * partialNotional;

        realizedProfit = partialProfitDollars.toFixed(2)

        console.log(`💰 Partial profit realized: $${partialProfitDollars.toFixed(2)}`);

        const fullQty = positionSize;
        const partialQty = roundQty(fullQty * fraction);
        const remainingQty = fullQty - partialQty;

        const remainingPositionSize = remainingQty;
        const remainingPositionSizeUSD = positionSizeUSD * (remainingQty / fullQty);

        // Update local size regardless (your “assume filled if touched” model)
        positionSize = remainingPositionSize;
        positionSizeUSD = remainingPositionSizeUSD;

        // Mark partial hit so you don't repeat
        partialTPHit = true;
        let newSlOrderId = null;

        const lockProfitPct = currentTP * PARTIAL_LOCK_PCT_OF_TP; // 5% of TP distance

        // signed SL value so it moves into profit direction
        currentSL = -lockProfitPct;

        partialLockedSLPrice = type === "BUY"
          ? entryPrice * (1 - currentSL)
          : entryPrice * (1 + currentSL);

        softSL = partialLockedSLPrice;


        if (BinanceTrading) {

          // ---- MOVE SL TO BE (SAFE) ----
          const oldSlOrderId = activeSlOrderId;

          const beSide = type === "BUY" ? "SELL" : "BUY";
          const beOrder = {
            algoType: "CONDITIONAL",
            symbol,
            side: beSide,
            type: "STOP_MARKET",
            triggerprice: roundPrice(partialLockedSLPrice),
            closePosition: true,
            workingType: "MARK_PRICE",
            timestamp: new Date().toISOString()
          };

          await safeAsync("Cancel old SL", () => CancelFuturesPlaceStopMarket(oldSlOrderId));

          const beResp = await safeAsync("Place BE STOP_MARKET", () =>
            futuresPlaceStopMarket(beOrder)
          );

          newSlOrderId = beResp?.clientAlgoId ? String(beResp.clientAlgoId) : null;
          activeSlOrderId = newSlOrderId;

        }


        // 3) DB update should never break the loop
        await safeAsync("DB upd-partial", () =>
          axios.post(
            `${process.env.backendURL}/bot/upd-partial`,
            {
              positionSize: remainingPositionSize,
              positionSizeUSD: remainingPositionSizeUSD,
              closedProfit: partialProfitDollars.toFixed(2),
              ...(newSlOrderId ? { slOrderId: newSlOrderId } : {}),
            },
            { headers: { Authorization: `Bearer A.saboor786` } }
          )
        );
      }

      // ===== continue with normal exit logic, but using high/low =====

      const slBroken = await isSLBroken(type);

      const hitTP = type === "BUY"
        ? high >= tp
        : low <= tp;

      const earlyExit = type === "BUY"
        ? low <= softSL || slBroken
        : high >= softSL || slBroken;

      const hardSL = type === "BUY"
        ? low <= softSL
        : high >= softSL;

      if (hitTP || earlyExit || hardSL) {

        // Calculate profit %
        let exitPrice;
        if (hitTP) {
          exitPrice = tp;
        } else if (hardSL) {
          exitPrice = softSL;
        } else {
          // earlyExit via EMA SL → you can use close, or low/high depending on direction
          exitPrice = type === "BUY" ? low : high;
        }


        const profitPercent =
          type === "BUY"
            ? (exitPrice - entryPrice) / entryPrice
            : (entryPrice - exitPrice) / entryPrice;

        let profitDollarsRemaining = profitPercent * positionSizeUSD - 0.45; // fee on final leg

        const isBreakEven = realizedProfit > 0 ? true : false;

        if (isBreakEven) {
          // 🔹 BE on remaining half: do NOT subtract the final fee here
          profitDollarsRemaining = 0;
        } else {
          // Normal case: PnL on remaining notional minus one fee
          profitDollarsRemaining = profitPercent * positionSizeUSD - 0.45;
        }

        const totalProfitDollars = realizedProfit + profitDollarsRemaining;

        console.log(`💰 Total profit for trade (partials + final): $${totalProfitDollars.toFixed(2)}`);
        console.log(`Trade Closed for ${type} at Price ${exitPrice}`);

        // Increment trade count
        tradeCount++;

        // Save trade history
        const historyResponse = await axios.post(`${process.env.backendURL}/bot/save-history`, { // WebUrl Here
          profit: totalProfitDollars.toFixed(2),
          entryPrice: entryPrice,
          atr: atr,
          slope: slope,
          time: new Date().toISOString(),
          tradeNumber: tradeCount,
          type: type,
          positionSize: positionSize,
          positionSizeUSD: positionSizeUSD,
          leverage: leverage,
          tpPrice: tpPrice ?? null,
          partialTpPrice: partialTpPrice ?? null,
          slPrice: slPrice ?? null,

          // (optional but very useful)
          exitPrice: exitPrice,
          partialTPHit: partialTPHit,
        },
          {
            headers: {
              Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
            }
          });

        const savedTradeId = historyResponse.data.tradeId;

        await updateLastTrade(prevTradeType, prevTradeTime, prevTradePrice, savedTradeId)
        SetLastDetails(prevTradeType, prevTradeTime, prevTradePrice, savedTradeId)

        if (real && LiveTrading) {  // upd in Real Bot 
          // Save trade history
          await axios.post(`${mainBotUrl}/bot/real-history`, { // WebUrl Here
            bot: symbol,
            profit: totalProfitDollars.toFixed(2),
            entryPrice: entryPrice,
            atr: atr,
            slope: slope,
            time: new Date().toISOString(),
            tradeNumber: tradeCount,
            type: type,
            positionSize: positionSize,
            positionSizeUSD: positionSizeUSD,
            leverage: leverage,
          },
            {
              headers: {
                Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
              }
            });


        }

        // Clear active trade
        await updateBotStatus(true, lastSignal, false);
        await axios.post(`${process.env.backendURL}/bot/clear-trade`,
          {},
          {
            headers: {
              Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
            }
          }); // WebUrl here


        console.log(`Trade Closed for ${type} at Price ${exitPrice}`);

        liveTradeCtx = null;
        partialTPHit = false;
        partialLockedSLPrice = null;
        lastTradeSignal = null;
      }
    }
  } catch (err) {
    console.log("No Active Trades");
    return;
  }
}


async function isSLBroken(type) {

  const res = await axios.get(`${process.env.backendURL}/bot/ema`,
    {
      headers: {
        Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
      }
    }); // WebUrl here 
  const { ema9, ema21, ema50, ema200 } = res.data.msg;

  const emaValues = [ema200, ema50, ema21, ema9]; // Assuming 200 is the longest

  if (type === "BUY") {
    const broken = emaValues.slice(1).some(v => v < emaValues[0]);
    if (broken) {
      console.log("Sl Hit (BUY)");
      return true;
    } else {
      console.log("Sl Not Hit (BUY)");
      return false;
    }
  }

  if (type === "SELL") {
    const broken = emaValues.slice(1).some(v => v > emaValues[0]);
    if (broken) {
      console.log("Sl Hit (SELL)");
      return true;
    } else {
      console.log("Sl Not Hit (SELL)");
      return false;
    }
  }

  console.log("Unknown Type or No SL Logic Applied");
  return false;
}


async function placeFuturesOrderWithDollarAmount(side, dollarAmount) {

  // 1. Get current price
  const price = await getPrice();

  const rawQty = dollarAmount / price;
  const quantity = Math.ceil(rawQty * 10) / 10; // rounds UP to 1 decimal place

  // 4. Place order
  const order = await placeFuturesOrder(symbol, side, quantity);

  return order;
}

async function setMarginType(symbol, marginType = 'ISOLATED') {
  try {
    return await futuresPostSigned('/fapi/v1/marginType', {
      symbol,
      marginType,
    });
  } catch (err) {
    if (err.response?.data?.code === -4046) {
      console.log("Margin type already set.");
    } else {
      console.error("Failed to set margin type:", err.response?.data || err.message);
    }
  }
}


async function setLeverage(symbol, leverage) {


  return await futuresPostSigned('/fapi/v1/leverage', { symbol, leverage });
}

// async function futuresPostSigned(endpoint, params = {}) {

//   const timestamp = Date.now();
//   const query = new URLSearchParams({ ...params, timestamp }).toString();
//   const signature = signRequest(query, process.env.secretKey);
//   const url = `${BASE_FAPI_URL}${endpoint}?${query}&signature=${signature}`;

//   const response = await axios.post(url, null, {
//     headers: {
//       'X-MBX-APIKEY': process.env.apiKey,
//     },
//   });
//   return response.data;

// }

async function futuresGetSigned(endpoint, params = {}) {
  return futuresSignedRequest("GET", endpoint, params);
}

async function futuresPostSigned(endpoint, params = {}) {
  return futuresSignedRequest("POST", endpoint, params);
}

async function futuresDeleteSigned(endpoint, params = {}) {
  return futuresSignedRequest("DELETE", endpoint, params);
}

function signRequest(queryString, secret) {

  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function placeFuturesOrder(symbol, side, quantity) {

  return await futuresPostSigned('/fapi/v1/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity,
  });
}

// async function futuresGetSigned(endpoint, params = {}) {

//   const timestamp = Date.now();
//   const query = new URLSearchParams({ ...params, timestamp }).toString();
//   const signature = signRequest(query, process.env.secretKey);
//   const url = `${BASE_FAPI_URL}${endpoint}?${query}&signature=${signature}`;



//   const response = await axios.get(url, {
//     headers: {
//       'X-MBX-APIKEY': process.env.apiKey,
//     },
//   });

//   return response.data;
// }

async function getFuturesBalance(req, res) {
  const balance = await futuresGetSigned('/fapi/v2/balance');
  res.send({
    Balance: balance
  })
}


// Close full position using our DB quantity × 1.5 (reduceOnly keeps it safe)
async function closePositionByQty(type, positionSize) {
  try {
    const side = type === 'BUY' ? 'SELL' : 'BUY';  // reverse side
    const baseQty = Math.abs(parseFloat(positionSize));

    if (baseQty === 0 || !Number.isFinite(baseQty)) {
      console.log("✅ No position size to close based on DB");
      return;
    }

    const multiplier = 1.5;
    const qty = +(baseQty * multiplier).toFixed(3); // send 1.5x, rounded to 3 dec

    const result = await futuresPostSigned('/fapi/v1/order', {
      symbol,
      side,
      type: 'MARKET',
      quantity: qty,
      reduceOnly: true, // ensures it ONLY reduces existing position
    });

    console.log(`✅ Position close request by DB qty * ${multiplier} (${qty}):`, result);
    return result;
  } catch (err) {
    console.error("❌ Failed to close position by qty:", err.response?.data || err.message);
  }
}

async function closePartialByQty(type, positionSize, fraction = 0.5) {
  try {
    const side = type === 'BUY' ? 'SELL' : 'BUY';
    const fullQty = Math.abs(parseFloat(positionSize));
    const qty = +(fullQty * fraction).toFixed(3);

    if (qty === 0 || !Number.isFinite(qty)) {
      console.log("✅ No partial qty to close based on DB");
      return;
    }

    const result = await futuresPostSigned('/fapi/v1/order', {
      symbol,
      side,
      type: 'MARKET',
      quantity: qty,
      reduceOnly: true,
    });

    console.log(`✅ Partially closed ${fraction * 100}% by DB qty (${qty}):`, result);
    return result;
  } catch (err) {
    console.error("❌ Failed to partially close by qty:", err.response?.data || err.message);
  }
}

async function initSymbolSettings() {
  try {
    await setMarginType(symbol, 'ISOLATED');
    await setLeverage(symbol, 10);
    console.log("✅ Margin type & leverage set for symbol", symbol);
  } catch (err) {
    console.error("❌ Failed to init symbol settings:", err.response?.data || err.message);
  }
}



module.exports = {
  startBot: waitForNext3MinCandle,
  stopBot: stopLoop,
  isBotActive,
  getBotStatusFromDB,
  startLoop,
  updateBotStatus,
  updLastSignal,
  initTradeCount,
  getFuturesBalance,
  calculateEmaSignal,
  setTpSl,
  getPrice,
  setLastTradeSignal,
  saveSubscription,
  getLastTradeFromDB,
  SetLastDetails,
  setTradeCandles,
  getCandlesFromDb,
  clearCandlesDataInDb,
  updatePartial,
  futuresGetSigned,
  futuresPostSigned,
  futuresDeleteSigned,
  setLiveTradeCtx
};
