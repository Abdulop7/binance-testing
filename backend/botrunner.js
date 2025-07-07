const axios = require("axios");
const crypto = require('crypto');
require('dotenv').config();
// const Binance = require('node-binance-api');

// const binance = new Binance().options({
//   APIKEY: process.env.apiKey,
//   APISECRET: process.env.secretKey
// });



const BASE_FAPI_URL = 'https://fapi.binance.com'; // Futures mainnet

let intervalRef = null;
let lastSignal = null; // <-- Declare here to keep it across calls
let tradeCount = 0; // Global scope (top of the script)
let currentBalance = 0

async function isPausedDueToNews() {
  try {
    const res = await axios.get("https://binance-backend-6n65.onrender.com/bot/show-news"); // Replace with your news fetch URL
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
    await axios.post("https://binance-backend-6n65.onrender.com/bot/status", { // WebUrl Here
      isActive: active,
      lastSignal: signal,
      inTrade: inTrade
    });
  } catch (err) {
    console.error("Failed to update bot status:", err.message);
  }
}

async function getBotStatusFromDB() {
  try {
    const res = await axios.get("https://binance-backend-6n65.onrender.com/bot/status"); // WebUrl here
    return res.data;
  } catch (err) {
    console.error("Failed to fetch bot status from DB:", err.message);
    return { isActive: false, lastSignal: null, inTrade: false };
  }
}

async function placeOrder(signal) {
  const leverage = 10;
  const capital = 100; // use your capital here
  const positionSizeUSD = capital * leverage;
  const { data } = await axios.get("https://binance-backend-6n65.onrender.com/bot/atr"); // WebUrl Here
  const { atr } = data;

  console.log(`Atr is ${atr}`);


  if (atr < 0.006) {
    console.log(`⛔ ATR too low at ${atr} — skipping trade.`);
  }
  else {

    const res = await axios.get("https://binance-backend-6n65.onrender.com/bot/view"); // WebUrl Here
    const entryPrice = res.data;

    const pairQuantity = (positionSizeUSD / entryPrice).toFixed(1); // ✅ More precise for low-price tokens

    await placeFuturesOrderWithDollarAmount(signal, currentBalance); // 2nd Arrgument is Position Size in $.

    // ⏰ Pakistan time manually (UTC + 5)
    const pakTime = new Date(Date.now() + 5 * 60 * 60 * 1000);

    // ⏰ Get 3m candle timestamp
    const now = Date.now();
    const candleTimestamp = now - (now % (3 * 60 * 1000)); // <-- 🆕 This is the key

    console.log(`Order placed for: ${signal} at ${entryPrice} on ${new Date().toLocaleTimeString()}`);


    await axios.post("https://binance-backend-6n65.onrender.com/bot/save-trade", { // WebUrl Here
      signal: signal,
      time: pakTime.toISOString(), // Saved in ISO format but in PKT
      price: entryPrice,
      positionSize: pairQuantity,
      positionSizeUSD: positionSizeUSD,
      leverage: leverage,
      candleTimestamp // 🆕 New field
    });

    await updateBotStatus(true, signal, true); // now inTrade is true
  }
}

async function getBalance() {

  const balanceData = await futuresGetSigned('/fapi/v2/account');

  const availableBalance = Math.floor(parseFloat(balanceData.availableBalance));
  currentBalance = availableBalance * 10
  console.log(`✅ Current Futures Wallet Balance: $${availableBalance}`);

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

  } else if (inTrade) {
    console.log(`Signal is ${newSignal}. But it is Already in Trade`);
    lastSignal = newSignal;
    await updateBotStatus(true, newSignal, inTrade);

  }
}

async function checkSignal() {

  const now = new Date();
  const pkDate = new Date(now.getTime() + 5 * 60 * 60 * 1000); // Shift to PKT
  const pkHour = (now.getUTCHours() + 5) % 24;
  const pkDay = pkDate.getDay(); // ✅ correct
  const newsPause = await isPausedDueToNews();


  const RestDay = pkDay === 0 || pkDay === 6; // Sunday or Saturday
  let pausedOnNews = newsPause;
  let restHours = pkHour >= 7 && pkHour < 13
  let finalRest = RestDay || pausedOnNews || restHours

  if (RestDay) {
    console.log("⛔ Bot is In Rest Due to RestDay");

  }
  if (restHours) {
    console.log("⛔ Bot is In Rest Due to Rest Hours");

  }

  const res = await axios.get("https://binance-backend-6n65.onrender.com/bot/ema"); // WebUrl
  const newSignal = res.data.msg.signal;

  if (newSignal !== lastSignal) {

    await signalChanged(newSignal, finalRest);
  }
  else {
    console.log(`Same signal: ${newSignal} at ${new Date().toLocaleTimeString()}`);
  }
  // await checkTPorSL(newSignal);

  // Still check TP/SL in all cases
  await checkTPorSL(finalRest ? null : newSignal);

}

async function startLoop() {
  intervalRef = setInterval(checkSignal, 1000 * 60 * 3);
  checkSignal(); // immediate first run
  console.log("Bot loop started.");
  await getBalance();
}

async function stopLoop() {
  try {
    clearInterval(intervalRef);
    intervalRef = null;
    lastSignal = null;

    const res = await axios.get('https://binance-backend-6n65.onrender.com/bot/get-trade');

    if (res?.data) {
      await axios.post("https://binance-backend-6n65.onrender.com/bot/clear-trade");
      await closePosition('SUIUSDT');
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
  const res = await axios.get("https://binance-backend-6n65.onrender.com/bot/last-trade");
  tradeCount = res.data.tradeNumber;
  console.log("✅ Trade count restored to:", tradeCount);
}

async function waitForNext3MinCandle() {

  console.log("⚙️  3min Function Running");

  const alreadyActive = await isBotActive();

  console.log("✅ Bot Active from DB:", alreadyActive);

  const res = await axios.get("https://binance-backend-6n65.onrender.com/bot/ema"); // WebUrl Here
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
    const tradeRes = await axios.get("https://binance-backend-6n65.onrender.com/bot/get-trade"); // WebUrl here 
    const { entryPrice, type, positionSize, positionSizeUSD, leverage, candleTimestamp } = tradeRes.data;

    console.log("Active Trade Found ✅");

    if (parseInt(candleTimestamp) === currentCandleTimestamp) {

      console.log("📛 Trade is still in entry candle — skipping SL/TP check");

    }
    else {

      // Get the current market price
      const res = await axios.get("https://binance-backend-6n65.onrender.com/bot/view"); // WebUrl here
      const currentPrice = res.data;

      // Set TP and check SL
      const tp = type === "BUY" ? entryPrice * 1.005 : entryPrice * 0.995;
      const softSL = type === "BUY"
        ? entryPrice * 0.992  // ~0.8% below for BUY
        : entryPrice * 1.008; // ~0.8% above for SELL

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

        // Calculate profit %
        const profitPercent =
          type === "BUY"
            ? (currentPrice - entryPrice) / entryPrice
            : (entryPrice - currentPrice) / entryPrice;

        // Use actual stored position size in USD
        const profitDollars = profitPercent * positionSizeUSD - 0.08; // Fee

        await closePosition('SUIUSDT');


        // Increment trade count
        tradeCount++;

        // Save trade history
        await axios.post("https://binance-backend-6n65.onrender.com/bot/save-history", { // WebUrl Here
          profit: profitDollars.toFixed(2),
          entryPrice: entryPrice,
          time: new Date().toISOString(),
          tradeNumber: tradeCount,
          type: type,
          positionSize: positionSize,
          positionSizeUSD: positionSizeUSD,
          leverage: leverage,
        });

        // Clear active trade
        await updateBotStatus(true, lastSignal, false);
        await axios.post("https://binance-backend-6n65.onrender.com/bot/clear-trade"); // WebUrl here

        await getBalance();

        console.log(`Trade Closed for ${type} at Price ${currentPrice}`);
      }
    }
  } catch (err) {
    console.log("No Active Trades");
    return;
  }
}


async function isSLBroken(type) {

  const res = await axios.get("https://binance-backend-6n65.onrender.com/bot/ema"); // WebUrl here 
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

  console.log("Place Future Order with Dollar Amount Function is running");

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

  console.log("Set Leverage Function is running");


  return await futuresPostSigned('/fapi/v1/leverage', { symbol, leverage });
}

async function futuresPostSigned(endpoint, params = {}) {

  console.log("Futures Post Signed Function is running");                                 


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

  console.log("Sign Request Function is Running");

  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function placeFuturesOrder(symbol, side, quantity) {

  console.log("Place Futures Order Function is Running");


  return await futuresPostSigned('/fapi/v1/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity,
  });
}

async function futuresGetSigned(endpoint, params = {}) {

  console.log("Futures Gets Signed Function is Running");


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

  console.log("Close Position Function is Running");


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
  getBalance
};
