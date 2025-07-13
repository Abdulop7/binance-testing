const cors = require('cors');
const express = require("express");
require("dotenv").config()
let app = express()
app.use(cors())
const axios = require('axios');
const { EMA } = require('technicalindicators');
app.use(express.json())
app.use(express.urlencoded({ extended: true }));
const port = process.env.PORT || 10000; // ✅ right

const allowedIPs = [
  '18.156.158.53', '18.156.42.200', '52.59.103.54' // Render IPs
  , '124.29.212.168' // Office IP
  , '124.29.212.168', '103.18.10.203' // Frontend IP
  ,
];

app.use((req, res, next) => {

  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(" ")[1];

  if (!token || token !== process.env.ACCESS_TOKEN) {
    // console.log(`⛔ Unauthorized access attempt to ${req.path}`);
    return res.status(403).send('Access denied');
  }

  next();
});


const mongoose = require("mongoose");
const BotRouter = require('./app/routes/botRoutes.js');
const { getBotStatusFromDB, updateBotStatus, startLoop, updLastSignal, initTradeCount, getBalance, calculateEmaSignal } = require('./botrunner.js');
const { startPriceSocket, startCandleSocket } = require('./binanceWebSocket.js');

app.use("/bot", BotRouter)


mongoose.connect(process.env.DbUrl).then(() => {
  console.log("Database Connected to :", process.env.DbUrl);

  app.listen(port, () => {
    console.log("Server is Running on:", port);

    // Delay initialization logic by 3 seconds
    startPriceSocket("suiusdt");
    startCandleSocket("suiusdt");
    setTimeout(async () => {
      try {
        const { isActive, inTrade } = await getBotStatusFromDB();
        console.log(`Bot isActive:${isActive}`);

        if (isActive) {
          console.log("Bot Activating...");

          let res = await calculateEmaSignal()
          const newSignal = res.msg.signal;
          console.log("✅ Last Signal Registered: ", newSignal);
          updLastSignal(newSignal);

          await updateBotStatus(true, newSignal, inTrade);

          initTradeCount();

          const now = new Date();
          const minutes = now.getMinutes();
          const seconds = now.getSeconds();

          const remainder = 3 - (minutes % 3);
          const delay = (remainder * 60 - seconds + 1) * 1000;

          console.log(`⏳ Waiting ${delay / 1000}s until next 3-min candle...`);

          setTimeout(() => {
            console.log("⏰ Delay over — executing start");
            try {
              startLoop(); // should log "✅ startLoop triggered"
            } catch (err) {
              console.error("❌ Failed to start bot inside timeout:", err.message);
            }
          }, delay);
        } else {
          console.log("🟡 Bot is inactive. Not restarting.");
        }
      } catch (err) {
        console.error("❌ Error during bot startup:", err.message);
      }
    }, 1000 * 30); // 3-second delay
  });
});

