const axios = require("axios");
const crypto = require('crypto');

const BASE_FAPI_URL = 'https://fapi.binance.com'; // Futures mainnet

let intervalRef = null;
let lastSignal = null; // <-- Declare here to keep it across calls

async function updateBotStatus(active, signal) {
  try {
    await axios.post("http://localhost:100/bot/status", {
      isActive: active,
      lastSignal: signal,
    });
  } catch (err) {
    console.error("Failed to update bot status:", err.message);
  }
}

async function getBotStatusFromDB() {
  try {
    const res = await axios.get("http://localhost:100/bot/status");
    return res.data;
  } catch (err) {
    console.error("Failed to fetch bot status from DB:", err.message);
    return { isActive: false, lastSignal: null };
  }
}

async function placeOrder(signal) {
  const res = await axios.get("http://localhost:100/bot/view"); // create this endpoint to return live price
  const entryPrice = res.data;

  //  await placeFuturesOrderWithDollarAmount(signal, dollarAmount);

  console.log(`Order placed for: ${signal} at ${entryPrice} on ${new Date().toLocaleTimeString()}`);

  console.log("Saving Trade .....");
  

  await axios.post("http://localhost:100/bot/save-trade", {
    signal:signal,
    time: new Date(),
    price: entryPrice,
  });

  console.log("Trade Saved ✅");
  
}


async function signalChanged(newSignal) {
  console.log(`Signal changed: ${lastSignal} → ${newSignal}`);
  lastSignal = newSignal;
  await updateBotStatus(true, newSignal);
  await placeOrder(newSignal);
}

async function checkSignal() {



    const res = await axios.get("http://localhost:100/bot/ema");
    const newSignal = res.data.msg.signal;

    

    if(newSignal === "WAIT"){

      console.log(`Same signal: ${newSignal} at ${new Date().toLocaleTimeString()}`);

    } 
    else if (newSignal !== lastSignal) {
      
      await signalChanged(newSignal);
    }
    else {
      console.log(`Same signal: ${newSignal} at ${new Date().toLocaleTimeString()}`);
    } 
    await checkTPorSL();

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
  await updateBotStatus(false, null);
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

  const res = await axios.get("http://localhost:100/bot/ema");
    const newSignal = res.data.msg.signal; 
    console.log("✅ Last Signal Registered");
    lastSignal = res.data.msg.signal // Updated the Local LastSignal
    

  await updateBotStatus(true, newSignal);
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

async function checkTPorSL() {
  try{


    console.log("Checking for Active Trades.....");

    let tradeRes = await axios.get("http://localhost:100/bot/get-trade");
    const { entryPrice, type } = tradeRes;
    
    console.log("Active Trade Found ✅");
    
    const res = await axios.get("http://localhost:100/bot/view");
    const currentPrice = res.data.price;


    const tp = type === "BUY"
      ? entryPrice * 1.01
      : entryPrice * 0.99;

    const slBroken = await isSLBroken(type);

    if ((type === "BUY" && currentPrice >= tp) || (type === "SELL" && currentPrice <= tp) || slBroken) {
      console.log(`📉 Exit condition met — closing trade for ${type}`);

      const profitPercent = type === "BUY"
        ? (currentPrice - entryPrice) / entryPrice
        : (entryPrice - currentPrice) / entryPrice;

        // await closePosition('BTCUSDT');

      await axios.post("http://localhost:100/bot/clear-trade");
      console.log(`Trade Closed for ${type} at Price ${currentPrice}`);
      
    }else{

      console.log("Sl Not Hit");
      
    }
      }catch(err){
        console.log("No Active Trades");
        
      }

}

async function isSLBroken(type) {

    console.log("Checking SL Conditions.....");
    

    const res = await axios.get("http://localhost:100/bot/ema");
    const { e8, e13, e21, e55 } = res.data;

    if (type === "BUY") return e55 > e21 || e55 > e13 || e55 > e8;
    if (type === "SELL") return e55 < e21 || e55 < e13 || e55 < e8;
    return false;

}

async function placeFuturesOrderWithDollarAmount( side, dollarAmount) {

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


module.exports = {
  startBot: waitForNext3MinCandle,
  stopBot: stopLoop,
  isBotActive,
};
