const WebSocket = require("ws");
const axios = require("axios");

let priceWS = null;
let candleWS = null;
let symbol = process.env.symbol;

let lastPricePing = Date.now();
let lastCandlePing = Date.now();
let latestPrice = null;
let latestCandle = null;
let candleBuffer = [];
const maxCandles = 1000;


// ------------------ PRICE SOCKET ----------------------

function startPriceSocket(symbol) {
  if (priceWS) priceWS.terminate();

  priceWS = new WebSocket(`wss://fstream.binance.com/ws/${symbol}@ticker`);

  priceWS.on("open", () => {
    console.log(`📡 Price WebSocket connected for ${symbol.toUpperCase()}`);
  });

  priceWS.on("message", (data) => {
    lastPricePing = Date.now();
    const parsed = JSON.parse(data);
    latestPrice = Math.round(parseFloat(parsed.c) * 10000) / 10000;
  });

  priceWS.on("error", (err) => {
    console.error("❌ Price WS error:", err.message);
  });

  priceWS.on("close", () => {
    console.log("⚠️ Price WS closed. Reconnecting...");
    setTimeout(() => startPriceSocket(symbol), 2000);
  });
}

// ------------------ CANDLE SOCKET ----------------------

function startCandleSocket(symbol) {
  if (candleWS) candleWS.terminate();

  candleWS = new WebSocket(`wss://fstream.binance.com/ws/${symbol}@kline_3m`);

  candleWS.on("open", () => {
    console.log(`🕒 Candle WebSocket connected for ${symbol.toUpperCase()}`);
  });

  candleWS.on("message", (data) => {
    lastCandlePing = Date.now();
    try {
      const parsed = JSON.parse(data);
      const kline = parsed.k;

      if (kline && kline.x) {
        const candle = {
          openTime: kline.t,
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          closes: parseFloat(kline.c),
          volume: parseFloat(kline.v),
          closeTime: kline.T,
        };

        latestCandle = candle;
        candleBuffer.push(candle);

        if (candleBuffer.length > maxCandles) {
          candleBuffer.shift(); // Remove oldest
        }
      }
    } catch (err) {
      console.error("❌ Failed to parse candle:", err.message);
    }
  });

  candleWS.on("error", (err) => {
    console.error("❌ Candle WS error:", err.message);
  });

  candleWS.on("close", () => {
    console.log("⚠️ Candle WS closed. Reconnecting...");
    setTimeout(() => startCandleSocket(symbol), 2000);
  });
}

// --------------- PREFILL ------------------

async function prefillCandles(symbol, interval = "3m", limit = 100) {
  try {

    axios.get('https://api.ipify.org?format=json')
      .then(res => {
        console.log('Public IP:', res.data.ip);
      })
      .catch(err => console.error(err));

    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const { data } = await axios.get(url);

    candleBuffer = data.map((c) => ({
      openTime: c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      closes: parseFloat(c[4]),
      volume: parseFloat(c[5]),
      closeTime: c[6],
    }));

    latestCandle = candleBuffer[candleBuffer.length - 1];
    console.log(`✅ 
      
      -filled ${candleBuffer.length} candles.`);
  } catch (err) {
    console.error("❌ Prefill error:", err.response.data.msg);
  }
}

async function getCandlesDataFromDb(interval = '3m') {
  try {
    const resp = await axios.get(
      `${process.env.backendURL}/bot/candles-data`,
      {
        params: { interval },
        headers: { Authorization: `Bearer A.saboor786` }
      }
    );

    if (resp.data.success) {
      const { candles, totalCandles, lastCloseTime } = resp.data;
      console.log(`📊 CandlesData: got ${totalCandles} candles, lastCloseTime=${lastCloseTime}`);
      return { candles, lastCloseTime };
    }

    return { candles: [], lastCloseTime: null };
  } catch (err) {
    console.error("❌ Failed to get CandlesData from DB:", err.message);
    return { candles: [], lastCloseTime: null };
  }
}

async function initCandleBufferFromDbOrPrefill(interval = '3m', limit = 100) {
  try {
    const { candles, lastCloseTime } = await getCandlesDataFromDb(interval);
    const now = Date.now();
    const MAX_STALE_MS = 3 * 60 * 1000; // 3 minutes

    const isFresh =
      candles.length > 0 &&
      typeof lastCloseTime === 'number' &&
      now - lastCloseTime <= MAX_STALE_MS;

    if (isFresh) {
      // Map DB candles → in-memory format used in candleBuffer
      candleBuffer = candles.map(c => ({
        openTime: c.openTime,
        open: c.open,
        high: c.high,
        low: c.low,
        closes: c.close,     // DB field is "close"; your buffer uses "closes"
        volume: c.volume,
        closeTime: c.closeTime,
      }));

      if (candleBuffer.length > maxCandles) {
        candleBuffer = candleBuffer.slice(-maxCandles);
      }

      latestCandle = candleBuffer[candleBuffer.length - 1];

      console.log(
        `🔥 Restored ${candleBuffer.length} candles from DB (lastCloseTime=${new Date(lastCloseTime).toISOString()})`
      );
    } else {
      console.log("⚠️ CandlesData stale or empty → calling prefillCandles from Binance...");
      await prefillCandles(symbol, interval, limit);
      // prefillCandles already fills candleBuffer & latestCandle
    }
  } catch (err) {
    console.error("❌ initCandleBufferFromDbOrPrefill error:", err.message);
    // As a fallback, try prefill anyway
    try {
      await prefillCandles(symbol, interval, limit);
    } catch (e) {
      console.error("❌ prefill fallback failed:", e.message);
    }
  }
}

// --------------- PUBLIC GETTERS ------------------

function getLatestPrice() {
  return latestPrice;
}

function getLatestCandle() {
  return {
    status: 1,
    ohlcv: [...candleBuffer],
  };
}

// --------------- FROZEN SOCKET WATCHDOG ------------------

setInterval(() => {
  const now = Date.now();

  if (now - lastPricePing > 20000) {

    whatsappAlert();

    console.log("⚠️ Price socket frozen → restarting...");
    startPriceSocket();
  }

  if (now - lastCandlePing > 20000) {

    whatsappAlert()

    console.log("⚠️ Candle socket frozen → restarting...");
    startCandleSocket();
  }

}, 10000);



function whatsappAlert() {

  const WHATSAPP_API_URL = "https://graph.facebook.com/v20.0";
  const PHONE_NUMBER_ID = 781950855010751; // from your Meta App
  const ACCESS_TOKEN = "EAATCd12aucIBP6AJtN2vO4esFtvUkdoAkHaNzZCkZCN7ZBes1GsG4Y3JlOEkqzADC0IH28Dxd22r8lS1nelMIUl4ZCLX28gDFQHYZApZBg3cqyEVDgHWghuhJuc5hxmNHVKJbA6LFZAxvRXzJxZAQf6rvQ1farDShZCqdxBA7Dbwjfo3LRjMHJvly7ZBe2eNamjAZDZD"; // from your Meta App


  axios.post(
    `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "923098113300",
      type: "template",
      template: {
        name: "reminder",
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Abdul Saboor" },
              { type: "text", text: `${symbol.toUpperCase()} Bot has Restarted Due to Break in Websocket` },
            ],
          },
        ],
      }


    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

}

module.exports = {
  startPriceSocket,
  startCandleSocket,
  prefillCandles,
  getLatestPrice,
  getLatestCandle,
  initCandleBufferFromDbOrPrefill
};
