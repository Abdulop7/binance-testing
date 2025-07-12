// binancePriceSocket.js
const WebSocket = require("ws");

let latestPrice = null;

function startPriceSocket(symbol = "suiusdt") {
  const ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol}@ticker`);

  ws.on("open", () => {
    console.log(`📡 WebSocket connected for ${symbol.toUpperCase()}`);
  });

  ws.on("message", (data) => {
    const parsed = JSON.parse(data);
    latestPrice = Math.round(parseFloat(parsed.c) * 10000) / 10000; // `c` = current price
    // console.log("Live price:", latestPrice); // Optional debug
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err.message);
  });

  ws.on("close", () => {
    console.log("⚠️ WebSocket closed. Reconnecting in 5s...");
    setTimeout(() => startPriceSocket(symbol), 5000);
  });
}

// Export functions
function getLatestPrice() {
  return latestPrice;
}

module.exports = { startPriceSocket, getLatestPrice };
