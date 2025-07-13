// binancePriceSocket.js
const WebSocket = require("ws");

let latestPrice = null;
let latestCandle = null;
let candleBuffer = []; // To store the latest 1000 candles
const maxCandles = 1000;

function startPriceSocket(symbol = "suiusdt") {
  const ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol}@ticker`);

  ws.on("open", () => {
    console.log(`📡 WebSocket connected for ${symbol.toUpperCase()}`);
  });

  ws.on("message", (data) => {
    const parsed = JSON.parse(data);
    latestPrice = Math.round(parseFloat(parsed.c) * 10000) / 10000; // `c` = current price
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err.message);
  });

  ws.on("close", () => {
    console.log("⚠️ WebSocket closed. Reconnecting in 5s...");
    setTimeout(() => startPriceSocket(symbol), 5000);
  });
}

function startCandleSocket(symbol = "suiusdt") {
  const ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol}@kline_3m`);

  ws.on("open", () => {
    console.log(`🕒 WebSocket connected for ${symbol.toUpperCase()} 3m candles`);
  });

  ws.on("message", (data) => {
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

        console.log("🟩 New 3m Candles:", candleBuffer);
      }
    } catch (err) {
      console.error("❌ Failed to parse candle:", err.message);
    }
  });

  ws.on("error", (err) => {
    console.error("❌ Candle WebSocket error:", err.message);
  });

  ws.on("close", () => {
    console.log("⚠️ Candle WebSocket closed. Reconnecting in 5s...");
    setTimeout(() => startCandleSocket(symbol), 5000);
  });
}

// Export functions
function getLatestPrice() {
  return latestPrice;
}

function getLatestCandle() {
  return { status: 1, ohlcv: [...candleBuffer] };
}

module.exports = {
  startPriceSocket,
  startCandleSocket,
  getLatestPrice,
  getLatestCandle,
};
