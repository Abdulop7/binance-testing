const axios = require("axios");
const crypto = require('crypto');
require('dotenv').config();
const { EMA } = require("technicalindicators");
const { getLatestPrice, getLatestCandle } = require("./binanceWebSocket");

// Our Position Size for 100$ in Binance will be = 1000$ position Size with 10x leverage
// Our Position Size for 100$ in Testing will be = 1000$ position Size with no Leverage because we cannot apply leverage in Simultation

async function getPrice() {

  let Fprice = await getLatestPrice()
  return Fprice
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

    const ema9 = EMA.calculate({ period: 8, values: data });
    const ema21 = EMA.calculate({ period: 13, values: data });
    const ema50 = EMA.calculate({ period: 21, values: data });
    const ema200 = EMA.calculate({ period: 55, values: data });

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


const BASE_FAPI_URL = 'https://fapi.binance.com'; // Futures mainnet

let intervalRef = null;
let lastSignal = null; // <-- Declare here to keep it across calls
let tradeCount = 0; // Global scope (top of the script)
let currentBalance = 0
const tpFn = createTPCalculator(3.00, 0.005, 4.00, 0.0085); // 0.5% to 0.85%
const slFn = createSLCalculator(3.00, 0.008, 4.00, 0.012);  // 0.8% to 1.2%
const positionSizeFn = createPositionSizeCalculator(3.00, 0.98, 4.00, 0.75); // 98% → 75%
let currentTP = 0
let currentSL = 0
let lastTradeSignal = null


async function setLastTradeSignal(signal) {

  lastTradeSignal = signal;

}

async function isPausedDueToNews() {
  try {
    const res = await axios.get(`${process.env.backendURL}/bot/show-news`,
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      }); // Replace with your news fetch URL
    const events = res.data;

    const now = new Date();

    for (const event of events) {
      const stop = new Date(event.stopTime);
      const resume = new Date(event.resumeTime);
      if (now >= stop && now < resume) {
        console.log(`⛔ Bot paused due to ${event.type} news `);
        return true;
      }
    }

    return false;

  } catch (err) {
    console.error("Failed to check news events:", err.message);
    return false;
  }
}

function updLastSignal(newSignal) {
  lastSignal = newSignal;
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
    return { isActive: false, lastSignal: null, inTrade: false };
  }
}

async function placeOrder(signal) {
  try {
    let leverage = 10
    const positionSizeUSD = currentBalance;

    const { data } = await axios.get(`${process.env.backendURL}/bot/atr`,
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      }); // WebUrl Here
    const { atr } = data;

    console.log(`Atr is ${atr}`);

    let LatestPrice = await getLatestPrice()
    const getATRFromPrice = createATRCalculator(3, 0.0060, 4, 0.0110);
    let ExpAtr = getATRFromPrice(LatestPrice)
    let endAtr = ExpAtr + 0.0040

    if (atr < ExpAtr || atr > endAtr) {
      console.log(`⛔ ATR is at ${atr} and it Should be between ${ExpAtr} to ${endAtr} — skipping trade.`);
    }
    else {

      await placeFuturesOrderWithDollarAmount(signal, currentBalance); // 2nd Arrgument is Position Size in $.


      const entryPrice = await getPrice();

      currentTP = tpFn(entryPrice)
      currentSL = slFn(entryPrice)

      const pairQuantity = (positionSizeUSD / entryPrice).toFixed(1); // ✅ More precise for low-price tokens


      // ⏰ Pakistan time manually (UTC + 5)
      const pakTime = new Date(Date.now() + 5 * 60 * 60 * 1000);

      // ⏰ Get 3m candle timestamp
      const now = Date.now();
      const candleTimestamp = now - (now % (3 * 60 * 1000)); // <-- 🆕 This is the key

      console.log(`Order placed for: ${signal} at ${entryPrice} on ${new Date().toLocaleTimeString()}`);

      lastTradeSignal = signal;


      await axios.post(`${process.env.backendURL}/bot/save-trade`, { // WebUrl Here
        signal: signal,
        time: pakTime.toISOString(), // Saved in ISO format but in PKT
        price: entryPrice,
        positionSize: pairQuantity,
        positionSizeUSD: positionSizeUSD,
        leverage: leverage,
        candleTimestamp // 🆕 New field
      },
        {
          headers: {
            Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
          }
        });

      await updateBotStatus(true, signal, true); // now inTrade is true
    }
  }
  catch (err) {
    const msg = err?.response?.data?.msg || err.message || "Unknown error";
    console.error(`❌ Place Order Error: ${msg}`);
  }

}

async function getBalance() {

  const balanceData = await futuresGetSigned('/fapi/v2/account');
  let availableBalance = parseFloat(balanceData.availableBalance);

  if (availableBalance < 75) {

    availableBalance = availableBalance * 0.75

  } else if (availableBalance < 50) {

    availableBalance = availableBalance * 0.5

  } else if (availableBalance < 25) {

    availableBalance = availableBalance * 0.25

  }

  const currentPrice = await getLatestPrice(); // ✅ fetch current price
  const dynamicPct = positionSizeFn(currentPrice); // dynamically calculate percentage

  // Use 98% of available balance
  let usableBalance = availableBalance * dynamicPct;

  // Round down and ensure safe default for very high balances
  usableBalance = (usableBalance >= 100) ? 100 : usableBalance;

  currentBalance = Math.floor(usableBalance * 10);
  console.log(`✅ Current Futures Wallet Balance: $${currentBalance}`);

}

async function isMaxDrawdownHit(maxDrawdownLimit = 20) {
  try {
    const res = await axios.get(`${process.env.backendURL}/bot/all-trades`, {
      headers: { Authorization: `Bearer A.saboor786` }
    });

    const allTrades = res.data;

    // Get today’s PKT date string (like "2025-07-15")
    const now = new Date();
    const pkNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const todayStr = pkNow.toISOString().slice(0, 10);

    // Filter today's trades using PKT-based trade time
    const todaysTrades = allTrades
      .filter(trade => {
        const tradeDate = new Date(new Date(trade.time).getTime() + 5 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        return tradeDate === todayStr;
      })
      .sort((a, b) => a.tradeNumber - b.tradeNumber); // Sort ascending

    // Cumulative equity calculation
    let equity = 0;
    let minEquity = 0;

    for (const trade of todaysTrades) {
      const profit = parseFloat(trade.profit) || 0;
      equity += profit;
      minEquity = Math.min(minEquity, equity);
    }

    const drawdown = Math.abs(minEquity);

    return drawdown >= maxDrawdownLimit;

  } catch (err) {
    console.error("❌ Error in isMaxDrawdownHit:", err.message);
    return false;
  }
}


async function signalChanged(newSignal, restStatus) {

  const { inTrade } = await getBotStatusFromDB();

  console.log("Checking InTrade From DB inside SignalChanged :", inTrade);


  if (newSignal === "WAIT") {
    console.log(`Signal changed: ${lastSignal} → ${newSignal}`);
    lastSignal = newSignal;
    await updateBotStatus(true, newSignal, inTrade);

  } else if (!inTrade) {
    console.log(`Signal changed: ${lastSignal} → ${newSignal}`);
    lastSignal = newSignal;
    await updateBotStatus(true, newSignal, inTrade);

    if (restStatus) {
      console.log('Bot is in Rest. Cant open Trade');
    } else {
      await placeOrder(newSignal);
    }

  } else if (inTrade && newSignal != lastTradeSignal) {
    console.log(`Signal changed: ${lastSignal} → ${newSignal}`);
    lastSignal = newSignal;
    await updateBotStatus(true, newSignal, inTrade);

    if (restStatus) {
      console.log('Bot is in Rest. Cant open Trade');
    } else {
      await placeOrder(newSignal);
    }

  }
  else if (inTrade) {
    console.log(`Signal is ${newSignal}. But it is Already in Trade`);
    lastSignal = newSignal;
    await updateBotStatus(true, newSignal, inTrade);

  }
}

async function checkSignal() {

  try {
    const now = new Date();
    const pkDate = new Date(now.getTime() + 5 * 60 * 60 * 1000); // Shift to PKT
    const pkHour = (now.getUTCHours() + 5) % 24;
    const pkDay = pkDate.getDay(); // ✅ correct
    const newsPause = await isPausedDueToNews();
    const drawdownHit = await isMaxDrawdownHit();


    const RestDay = pkDay === 0 || pkDay === 6; // Sunday or Saturday
    let pausedOnNews = newsPause;
    let restHours = pkHour >= 7 && pkHour < 13
    let finalRest = RestDay || pausedOnNews || restHours || drawdownHit

    if (RestDay) console.log("⛔ Bot is In Rest Due to RestDay");
    if (restHours) console.log("⛔ Bot is In Rest Due to Rest Hours");
    if (drawdownHit) console.log("⛔ Bot is Paused Due to Max Daily Drawdown");

    let res = await calculateEmaSignal()
    const newSignal = res.msg.signal;

    if (newSignal == undefined) {

      console.log("Signal is Undefined. Error in Check Signal");

    } else if (newSignal !== lastSignal) {

      await signalChanged(newSignal, finalRest);
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

function createPositionSizeCalculator(price1, pct1, price2, pct2) {
  const slope = (pct2 - pct1) / (price2 - price1);
  return function (price) {
    return +(pct1 + slope * (price - price1));
  };
}


function createATRCalculator(price1, atr1, price2, atr2) {
  const n = Math.log(atr2 / atr1) / Math.log(price2 / price1);
  const k = atr1 / Math.pow(price1, n);

  return function (price) {
    return +(k * Math.pow(price, n)).toFixed(4);
  };
}

function createTPCalculator(price1, tp1, price2, tp2) {
  const slope = (tp2 - tp1) / (price2 - price1);
  return function (price) {
    return +(tp1 + slope * (price - price1)).toFixed(4);
  };
}


function createSLCalculator(price1, sl1, price2, sl2) {
  const slope = (sl2 - sl1) / (price2 - price1);
  return function (price) {
    return +(sl1 + slope * (price - price1)).toFixed(4);
  };
}

async function setTpSl() {
  try {
    const resp = await axios.get(`${process.env.backendURL}/bot/get-trade`, {
      headers: { Authorization: `Bearer A.saboor786` }
    });

    const trade = resp?.data;
    if (!trade || trade.entryPrice == null) {
      console.log("ℹ️ No active trade found to set TP/SL.");
      return { ok: false, msg: "no-trade" };
    }

    const entry = Number(trade.entryPrice);
    if (!Number.isFinite(entry) || entry <= 0) {
      console.error("❌ Invalid entryPrice in active trade:", trade.entryPrice);
      return { ok: false, msg: "bad-entry" };
    }

    const tpPctDec = tpFn(entry); // decimal (e.g., 0.006 = 0.6%)
    const slPctDec = slFn(entry); // decimal

    currentTP = tpPctDec;
    currentSL = slPctDec;

    console.log(
      `🎯 currentTP/currentSL set from active trade entry=${entry}: ` +
      `TP=${(tpPctDec * 100).toFixed(3)}% SL=${(slPctDec * 100).toFixed(3)}%`
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

  await getBalance();
  intervalRef = setInterval(checkSignal, 1000 * 60 * 3);
  checkSignal(); // immediate first run
  console.log("Bot loop started.");
}

async function stopLoop() {
  try {
    clearInterval(intervalRef);
    intervalRef = null;
    lastSignal = null;

    const res = await axios.get(`${process.env.backendURL}/bot/get-trade`,
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      });

    if (res?.data) {
      await closePosition('SUIUSDT');
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
    console.log("Bot stopped.");

  } catch (err) {
    console.error("Error in stopLoop:", err.response?.status, err.message);
    await updateBotStatus(false, null, false);
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
    const { entryPrice, type, positionSize, positionSizeUSD, leverage, candleTimestamp } = tradeRes.data;

    console.log("Active Trade Found ✅");

    if (parseInt(candleTimestamp) === currentCandleTimestamp) {

      console.log("📛 Trade is still in entry candle — skipping SL/TP check");

    }
    else {

      // Get the current market price
      const currentPrice = await getPrice();

      // Set TP and check SL
      const tp = type === "BUY" ? entryPrice * (1 + currentTP) : entryPrice * (1 - currentTP);
      const softSL = type === "BUY"
        ? entryPrice * (1 - currentSL)  // ~0.8% below for BUY
        : entryPrice * (1 + currentSL); // ~0.8% above for SELL

      const slBroken = await isSLBroken(type);

      const hitTP = (type === "BUY" && currentPrice >= tp) || (type === "SELL" && currentPrice <= tp);
      const earlyExit = type === "BUY"
        ? currentPrice <= softSL || slBroken
        : currentPrice >= softSL || slBroken;

      // Optional hard SL (exact 0.8% move)
      const hardSL = type === "BUY"
        ? currentPrice <= softSL
        : currentPrice >= softSL;

      if (hitTP || earlyExit || hardSL) {

        await closePosition('SUIUSDT');

        // Calculate profit %
        const profitPercent =
          type === "BUY"
            ? (currentPrice - entryPrice) / entryPrice
            : (entryPrice - currentPrice) / entryPrice;

        // Use actual stored position size in USD
        const profitDollars = profitPercent * positionSizeUSD - 0.45; // Fee



        // Increment trade count
        tradeCount++;

        // Save trade history
        await axios.post(`${process.env.backendURL}/bot/save-history`, { // WebUrl Here
          profit: profitDollars.toFixed(2),
          entryPrice: entryPrice,
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

        // Clear active trade
        await updateBotStatus(true, lastSignal, false);
        await axios.post(`${process.env.backendURL}/bot/clear-trade`,
          {},
          {
            headers: {
              Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
            }
          }); // WebUrl here

        await getBalance();

        console.log(`Trade Closed for ${type} at Price ${currentPrice}`);

        lastTradeSignal = null
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
  const priceResponse = await axios.get(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=SUIUSDT`);
  const price = parseFloat(priceResponse.data.price);

  const rawQty = dollarAmount / price;
  const quantity = Math.ceil(rawQty * 10) / 10; // rounds UP to 1 decimal place

  await setMarginType("SUIUSDT", 'ISOLATED');

  // 3. Set leverage
  await setLeverage("SUIUSDT", 10); // Leverage set Manually. Set the Leverage to 10 after Testing

  // 4. Place order
  const order = await placeFuturesOrder("SUIUSDT", side, quantity);

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

async function futuresPostSigned(endpoint, params = {}) {

  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp }).toString();
  const signature = signRequest(query, process.env.secretKey);
  const url = `${BASE_FAPI_URL}${endpoint}?${query}&signature=${signature}`;

  const response = await axios.post(url, null, {
    headers: {
      'X-MBX-APIKEY': process.env.apiKey,
    },
  });
  return response.data;

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

async function futuresGetSigned(endpoint, params = {}) {

  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp }).toString();
  const signature = signRequest(query, process.env.secretKey);
  const url = `${BASE_FAPI_URL}${endpoint}?${query}&signature=${signature}`;

  const response = await axios.get(url, {
    headers: {
      'X-MBX-APIKEY': process.env.apiKey,
    },
  });

  return response.data;
}


async function closePosition(symbol) {

  try {
    // 1. Get current open position
    const accountInfo = await futuresGetSigned('/fapi/v2/positionRisk');
    const position = accountInfo.find(p => p.symbol === symbol);

    if (!position) {
      console.error("⚠️ Position not found");
      return;
    }

    const qty = Math.abs(parseFloat(position.positionAmt));
    const side = parseFloat(position.positionAmt) > 0 ? "SELL" : "BUY"; // reverse side

    if (qty === 0) {
      console.log("✅ No open position to close");
      return;
    }

    // 2. Close position with market order
    const result = await futuresPostSigned('/fapi/v1/order', {
      symbol,
      side,
      type: 'MARKET',
      quantity: qty,
      reduceOnly: true, // ensures it won't open a new position
    });

    console.log("✅ Position closed:", result);
    return result;

  } catch (err) {
    console.error("❌ Failed to close position:", err.response?.data || err.message);
  }
}

async function getFuturesBalance(req, res) {
  const balance = await futuresGetSigned('/fapi/v2/balance');
  res.send({
    Balance: balance
  })
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
  getBalance,
  calculateEmaSignal,
  setTpSl,
  getPrice,
  setLastTradeSignal
};
