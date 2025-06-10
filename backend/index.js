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


mongoose.connect(process.env.MONGO_URI).then(()=>{
    console.log("Database Connected to :",process.env.DbUrl);
    
    app.listen(process.env.Port, () => {
        console.log("Server is Running on:", process.env.Port);
    
    })
})
