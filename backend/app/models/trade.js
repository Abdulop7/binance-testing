// models/Trade.js
const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
    entryTime: Date,
    entryPrice: Number,
    tpPrice: Number,
    tpPctDec: Number,
    partialTpPrice: Number,
    slPrice: Number,
    realizedProfit: {
        type: Number,
        default: 0, // sum of partial profits so far
    },
    real: Boolean,
    atr: Number,
    slope: Number,
    type: String,
    positionSize: Number,
    positionSizeUSD: Number,
    leverage: Number,
    candleTimestamp: Number,
    slOrderId: {
        type: String,
        default: null
    },
    tp1OrderId: {
        type: String,
        default: null
    },
    tp2OrderId: {
        type: String,
        default: null
    },
});

module.exports = mongoose.model('Trade', tradeSchema);