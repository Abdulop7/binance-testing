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
const { getBotStatusFromDB, checkSignal, startLoop } = require('./botrunner.js');

app.use("/bot", BotRouter)


mongoose.connect(process.env.DbUrl).then(() => {
    console.log("Database Connected to :", process.env.DbUrl);

    app.listen(port, async () => {
        console.log("Server is Running on:", port);

        // On server startup
        const { isActive } = await getBotStatusFromDB();
        
        if (isActive) {
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
        } else {
            console.log("🟡 Bot is inactive. Not restarting.");
        }

    })
})
