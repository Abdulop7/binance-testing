const axios = require("axios");
const crypto = require('crypto');

const BASE_FAPI_URL = 'https://fapi.binance.com'; // Futures mainnet

let intervalRef = null;
let lastSignal = null; // <-- Declare here to keep it across calls
let tradeCount = 0; // Global scope (top of the script)


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
  const res = await axios.get("https://binance-backend-6n65.onrender.com/bot/view"); // WebUrl Here
  const entryPrice = res.data;

  const pairQuantity = (positionSizeUSD / entryPrice).toFixed(4); // ✅ More precise for low-price tokens

  //  await placeFuturesOrderWithDollarAmount(signal, dollarAmount);

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


async function signalChanged(newSignal) {

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
    await placeOrder(newSignal);
  } else if (inTrade) {
    console.log(`Signal is ${newSignal}. But it is Already in Trade`);

  }
}

async function checkSignal() {

  const now = new Date();
  const pkHour = (now.getUTCHours() + 5) % 24;

  if (pkHour >= 7 && pkHour < 13) {
    console.log("⛔ Bot is paused from 7:00 AM to 1:00 PM PKT");
    checkTPorSL(null)
  } 
  else {

    const res = await axios.get("https://binance-backend-6n65.onrender.com/bot/ema"); // WebUrl
    const newSignal = res.data.msg.signal;

    if (newSignal !== lastSignal) {

      await signalChanged(newSignal);
    }
    else {
      console.log(`Same signal: ${newSignal} at ${new Date().toLocaleTimeString()}`);
    }
    await checkTPorSL(newSignal);
  }

}

function startLoop() {
  intervalRef = setInterval(checkSignal, 1000 * 60 * 3);
  checkSignal(); // immediate first run
  console.log("Bot loop started.");
}

async function stopLoop() {
  clearInterval(intervalRef);
  intervalRef = null;
  lastSignal = null;
  await updateBotStatus(false, null, false);
  console.log("Bot stopped.");
}

async function isBotActive() {
  const { isActive } = await getBotStatusFromDB();
  return isActive;
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
      const tp = type === "BUY" ? entryPrice * 1.01 : entryPrice * 0.99;
      const slBroken = await isSLBroken(type);

      const hitTP = (type === "BUY" && currentPrice >= tp) || (type === "SELL" && currentPrice <= tp);

      if (hitTP || slBroken) {
        
        // Calculate profit %
        const profitPercent =
          type === "BUY"
            ? (currentPrice - entryPrice) / entryPrice
            : (entryPrice - currentPrice) / entryPrice;

        // Use actual stored position size in USD
        const profitDollars = profitPercent * positionSizeUSD - 0.08; // Fee

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

        console.log(`Trade Closed for ${type} at Price ${currentPrice}`);
      }
    }
  } catch (err) {
    console.log("No Active Trades");
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
  const priceResponse = await axios.get(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT`);
  const price = parseFloat(priceResponse.data.price);
  console.log("It Calulated the Dollar Amount");


  // 2. Calculate quantity (contracts)
  const quantity = (dollarAmount / price).toFixed(3); // adjust decimals per symbol precision

  // 3. Set leverage
  await setLeverage("BTCUSDT", 10); // Leverage set Manually

  // 4. Place order
  const order = await placeFuturesOrder("BTCUSDT", side, quantity);

  return order;
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


// function pauseMonitorLoop() {
//   setInterval(async () => {
//     const now = new Date();
//     const utcHour = now.getUTCHours(); // Always in UTC
//     const pkHour = (utcHour + 5) % 24; // Convert to Pakistan time

//     if (pkHour >= 7 && pkHour < 13) {
//       console.log(`⛔ Bot paused from 7:00 AM to 1:00 PM (PKT) — Current time in PKT: ${pkHour}:00`);
//       await updateBotStatus(true, null, true);
//     } else {
//       console.log(`✅ Bot active hours (PKT) — Current time: ${pkHour}:00`);
//     }
//   }, 3 * 60 * 1000); // every 3 minutes
// }


module.exports = {
  startBot: waitForNext3MinCandle,
  stopBot: stopLoop,
  isBotActive,
};
