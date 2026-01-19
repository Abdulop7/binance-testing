// models/Trade.js
const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
    entryTime: Date,
    entryPrice: Number,
    atr: Number,
    slope:Number,
    type: String,
    positionSize: Number,
    positionSizeUSD: Number,
    leverage: Number,
    candleTimestamp: Number
});

module.exports = mongoose.model('Trade', tradeSchema);