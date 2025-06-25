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
const { getBotStatusFromDB, checkSignal } = require('./botrunner.js');

app.use("/bot", BotRouter)


mongoose.connect(process.env.DbUrl).then(() => {
    console.log("Database Connected to :", process.env.DbUrl);

    app.listen(port, async() => {
        console.log("Server is Running on:", port);
            
        // On server startup
        const { isActive } = await getBotStatusFromDB();
        if (isActive) {
            console.log("🚀 Bot was previously active. Restarting loop...");
            checkSignal(); // Auto-start logic
        } else {
            console.log("🟡 Bot is inactive. Not restarting.");
        }

    })
})
