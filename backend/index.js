const cors = require('cors');
const express = require("express");
require("dotenv").config()
let app = express()
app.use(cors())
const axios = require('axios');
const { EMA } = require('technicalindicators');
app.use(express.json())
app.use(express.urlencoded({ extended: true }));

const mongoose = require("mongoose");
const BotRouter = require('./app/routes/botRoutes.js');

app.use("/bot",BotRouter)

const path = require("path");

// Serve static files from the "public" directory (Vite build output)
app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});



mongoose.connect(process.env.DbUrl).then(()=>{
    console.log("Database Connected to :",process.env.DbUrl);
    
    app.listen(process.env.Port,'0.0.0.0', () => {
        console.log("Server is Running on:", process.env.Port);
    
    })
})
