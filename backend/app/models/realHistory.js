const mongoose = require("mongoose");
let Schema = mongoose.Schema;

let RealHistorySchema = new Schema({
    bot:String,
    tradeNumber: Number,
    entryPrice: Number,
    atr: Number,
    profit: Number,
    slope: Number,
    time: { type: Date, default: Date.now },
    type: String,
    positionSize: Number,
    positionSizeUSD: Number,
    leverage: Number
})

module.exports = mongoose.model("RealHistory", RealHistorySchema)