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

const mongoose = require("mongoose");
const BotRouter = require('./app/routes/botRoutes.js');
const { getBotStatusFromDB, updateBotStatus, startLoop, updLastSignal } = require('./botrunner.js');

app.use("/bot", BotRouter)


mongoose.connect(process.env.DbUrl).then(() => {
  console.log("Database Connected to :", process.env.DbUrl);

  app.listen(port, () => {
    console.log("Server is Running on:", port);

    // Delay initialization logic by 3 seconds
    setTimeout(async () => {
      try {
        const { isActive, inTrade } = await getBotStatusFromDB();
        console.log(`Bot isActive:${isActive}`);

        if (isActive) {
          console.log("Bot Activating...");

          const res = await axios.get("https://binance-backend-6n65.onrender.com/bot/ema"); // WebUrl
          const newSignal = res.data.msg.signal;
          console.log("✅ Last Signal Registered: ", newSignal);
          updLastSignal(newSignal);

          await updateBotStatus(true, newSignal, inTrade);

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
    }, 1000 * 10); // 3-second delay
  });
});

