const mongoose = require("mongoose");
let Schema = mongoose.Schema;

const candleSchema = new Schema(
  {
    openTime: { type: Number, required: true },   // ms
    open:     { type: Number, required: true },
    high:     { type: Number, required: true },
    low:      { type: Number, required: true },
    close:    { type: Number, required: true },
    volume:   { type: Number, required: true },
    closeTime:{ type: Number, required: true },   // ms
  },
  { _id: false }
);

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
    mfe: Number,
    mae: Number,
    mfePercent: Number,
    maePercent: Number,
    partialTPHit: Boolean,
    exitPrice: Number,
    tpPrice: Number,
    partialTpPrice: Number,
    slPrice: Number,
    candles: {
        type: [candleSchema],
        default: [],
    },
})

module.exports = mongoose.model("TradeHistory", TradeHistorySchema)