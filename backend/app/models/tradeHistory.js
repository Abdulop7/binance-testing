const mongoose = require("mongoose");
let Schema =mongoose.Schema;

let TradeHistorySchema = new Schema({
    tradeNumber:Number,
    entryPrice:Number,
    profit:Number,
    time: { type: Date, default: Date.now },
    type:String,
    positionSize:Number,
    positionSizeUSD:Number,
    leverage:Number
})

module.exports = mongoose.model("TradeHistory", TradeHistorySchema)