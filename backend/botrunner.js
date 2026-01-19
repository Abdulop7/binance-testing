const axios = require("axios");
const crypto = require('crypto');
const webpush = require('web-push');
require('dotenv').config();
const { EMA } = require("technicalindicators");
const { getLatestPrice, getLatestCandle } = require("./binanceWebSocket");


// Our Position Size for 100$ in Binance will be = 1000$ position Size with 10x leverage
// Our Position Size for 100$ in Testing will be = 1000$ position Size with no Leverage because we cannot apply leverage in Simultation

async function getPrice() {

  let Fprice = await getLatestPrice()
  return Fprice
}

async function calculateMFEandMAE(entryPrice, entryTimestamp, type) {
  // MFE = Maximum Favourable Movement (using candle CLOSE)
  // MAE = Maximum Adverse Excursion (using candle CLOSE)

  try {
    const symbol = process.env.symbol;

    // Convert timestamps to milliseconds
    const fromMs = new Date(entryTimestamp).getTime();
    const toMs = Date.now();

    // Fetch klines (candles): every 3m candle from entry to now
    const limit = Math.ceil((toMs - fromMs) / (3 * 60 * 1000)) + 1;
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=3m&startTime=${fromMs}&endTime=${toMs}&limit=${limit}`;

    const response = await axios.get(url);
    const klines = response.data;

    if (!klines || klines.length === 0) {
      console.log("No candles found since entry.");
      return null;
    }

    // Extract CLOSE prices from each candle (index 4)
    const closes = klines.map(k => parseFloat(k[4]));

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


const BASE_FAPI_URL = 'https://fapi.binance.com'; // Futures mainnet
let intervalRef = null;
let lastSignal = null; // <-- Declare here to keep it across calls
let tradeCount = 0; // Global scope (top of the script)
let currentBalance = 1000
const OPTIMIZER_DAYS = 10;          // Look back period
const MIN_TRADES_FOR_COMBO = 5;     // Minimum trades for a combo to be valid

// Track sent times to avoid duplicate sends
let lastSent = {
  "10:00": null,
  "13:00": null,
  "16:00": null,
  "19:00": null
};

const allowedDays = [1, 2, 3, 4, 5, 6]; // NO SUNDAY


let currentTP = 0
let currentSL = 0
let lastTradeSignal = null
let emaHistory = []
let subscriptions = [];

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



async function setLastTradeSignal(signal) {

  lastTradeSignal = signal;

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
    let leverage = 10
    const positionSizeUSD = currentBalance;

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



    // await placeFuturesOrderWithDollarAmount(signal, currentBalance); // 2nd Arrgument is Position Size in $.
    console.log(`Slope is ${Math.abs(slope).toFixed(4)}`);
    console.log(`Atr is ${atr}`);

    const entryPrice = await getPrice();

    currentTP = 0.0085
    currentSL = getSL(atr)
    console.log(currentSL)

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
      atr: atr,
      slope: Number(Math.abs(slope).toFixed(4)),
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

  // if (availableBalance < 75) {

  //   availableBalance = availableBalance * 0.75

  // } else if (availableBalance < 50) {

  //   availableBalance = availableBalance * 0.5

  // } else if (availableBalance < 25) {

  //   availableBalance = availableBalance * 0.25

  // }

  const currentPrice = await getLatestPrice(); // ✅ fetch current price
  // const dynamicPct = positionSizeFn(currentPrice); // dynamically calculate percentage

  // Use 98% of available balance
  let usableBalance = availableBalance * 0.95;

  // Round down and ensure safe default for very high balances
  usableBalance = (usableBalance >= 100) ? 100 : usableBalance;

  currentBalance = Math.floor(usableBalance * 10);
  console.log(`✅ Current Futures Wallet Balance: $${currentBalance}`);

}

// async function isMaxDrawdownHit(maxDrawdownLimit = 20) {
//   try {
//     const res = await axios.get(`${process.env.backendURL}/bot/all-trades`, {
//       headers: { Authorization: `Bearer A.saboor786` }
//     });

//     const allTrades = res.data;

//     // Get today’s PKT date string (like "2025-07-15")
//     const now = new Date();
//     const pkNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
//     const todayStr = pkNow.toISOString().slice(0, 10);

//     // Filter today's trades using PKT-based trade time
//     const todaysTrades = allTrades
//       .filter(trade => {
//         const tradeDate = new Date(new Date(trade.time).getTime() + 5 * 60 * 60 * 1000)
//           .toISOString()
//           .slice(0, 10);
//         return tradeDate === todayStr;
//       })
//       .sort((a, b) => a.tradeNumber - b.tradeNumber); // Sort ascending

//     // Cumulative equity calculation
//     let equity = 0;
//     let minEquity = 0;

//     for (const trade of todaysTrades) {
//       const profit = parseFloat(trade.profit) || 0;
//       equity += profit;
//       minEquity = Math.min(minEquity, equity);
//     }

//     const drawdown = Math.abs(minEquity);

//     return drawdown >= maxDrawdownLimit;

//   } catch (err) {
//     console.error("❌ Error in isMaxDrawdownHit:", err.message);
//     return false;
//   }
// }


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
        maePercent: excursion.maePercent
      },
      {
        headers: { Authorization: `Bearer A.saboor786` }
      }
    );

    await updateLastTrade(null, null, null, null)
    SetLastDetails(null, null, null, null)

  }
  catch (err) {
    const msg = err?.response?.data?.msg || err.message || "Unknown error";
    console.error(`❌ Handle MFE Error: ${msg}`);
  }

}

async function checkSignal() {

  try {
    const now = new Date();
    const pkDate = new Date(now.getTime() + 5 * 60 * 60 * 1000); // Shift to PKT
    const pkHour = (now.getUTCHours() + 5) % 24;
    const pkMinute = pkDate.getMinutes();
    const pkDay = pkDate.getDay(); // ✅ correct

    let finalRest = false;


    let res = await calculateEmaSignal()
    const newSignal = res.msg.signal;
    const ema200 = parseFloat(res.msg.ema200.toFixed(4));
    updateEMA(ema200);

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


    ////// The Reminders here 

    try {



      if (!allowedDays.includes(pkDay)) {
        return; // 🚫 Do nothing on Sundays
      }

      const currentTime = `${pkHour.toString().padStart(2, "0")}:${pkMinute
        .toString()
        .padStart(2, "0")}`;

      const triggerTimes = ["10:00", "13:00", "16:00", "19:00"];

      for (const time of triggerTimes) {
        if (currentTime === time && lastSent[time] !== pkDate.toDateString()) {

          // 🔥 Trigger your WhatsApp API here
          sendWhatsappMessage();

          lastSent[time] = pkDate.toDateString(); // Mark as sent for today
        }
      }


    }
    catch (err) {
      console.log(err.message);
    }



    //////
  }
  catch (err) {
    const msg = err?.response?.data?.msg || err.message || "Unknown error";
    console.error(`❌ Check Signal Error: ${msg}`);
  }

}

function sendWhatsappMessage() {
  return axios.get("https://www.anuarchitect.com/api/sendReminder");
}


function getSL(atr) {
  let sl = atr * 1.5;
  return sl.toFixed(4);
}

async function setTpSl() {
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

    const tpPctDec = 0.0085; // decimal (e.g., 0.006 = 0.6%)
    const slPctDec = getSL(atr); // decimal

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

  // await getBalance();
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
      await closePosition(symbol);
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

    console.log("Bot stopped.");

  } catch (err) {
    console.error("Error in stopLoop:", err.response?.status, err.message);
    await updateBotStatus(false, null, false);
    await updateLastTrade(null, null, null, null)
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
    const { entryPrice, type, positionSize, positionSizeUSD, leverage, atr, slope, candleTimestamp } = tradeRes.data;

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
        ? Number(entryPrice) - Number(currentSL)
        : Number(entryPrice) + Number(currentSL);
      console.log(`Entry Price is = ${entryPrice}. Current SL is = ${currentSL}`);

      console.log(`Soft SL is = ${softSL}`)

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

        // await closePosition('SUIUSDT');

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
        const historyResponse = await axios.post(`${process.env.backendURL}/bot/save-history`, { // WebUrl Here
          profit: profitDollars.toFixed(2),
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
        const savedTradeId = historyResponse.data.tradeId;        
        

        await updateLastTrade(prevTradeType, prevTradeTime, prevTradePrice, savedTradeId)
        SetLastDetails(prevTradeType, prevTradeTime, prevTradePrice, savedTradeId)

        // Clear active trade
        await updateBotStatus(true, lastSignal, false);
        await axios.post(`${process.env.backendURL}/bot/clear-trade`,
          {},
          {
            headers: {
              Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
            }
          }); // WebUrl here

        // await getBalance();

        console.log(`Trade Closed for ${type} at Price ${currentPrice}`);

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
  calculateEmaSignal,
  setTpSl,
  getPrice,
  setLastTradeSignal,
  saveSubscription,
  getLastTradeFromDB,
  SetLastDetails
};
