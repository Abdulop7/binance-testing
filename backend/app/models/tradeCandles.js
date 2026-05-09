const mongoose = require("mongoose");
let Schema = mongoose.Schema;

const candleSchema = new mongoose.Schema(
    {
        openTime: { type: Number, required: true },   // ms
        open: { type: Number, required: true },
        high: { type: Number, required: true },
        low: { type: Number, required: true },
        close: { type: Number, required: true },
        volume: { type: Number, required: true },
        closeTime: { type: Number, required: true },   // ms
    },
    { _id: false }
);

let tradeCandlesSchema = new Schema({
    candleCloses: {
        type: [candleSchema],
        default: [],
    },

}, { timestamps: true })

let statusModel = mongoose.model("TradeCandles", tradeCandlesSchema)

module.exports = statusModel