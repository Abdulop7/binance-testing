const mongoose = require("mongoose");
let Schema = mongoose.Schema;

let TradeHistorySchema = new Schema({
    tradeNumber: Number,
    entryPrice: Number,
    atr: Number,
    profit: Number,
    slope: Number,
    time: { type: Date, default: Date.now },
    type: String,
    positionSize: Number,
    positionSizeUSD: Number,
    leverage: Number,
    mfe:Number,
    mae:Number,
    mfePercent:Number,
    maePercent:Number
})

module.exports = mongoose.model("TradeHistory", TradeHistorySchema)