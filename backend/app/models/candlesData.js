// models/CandlesData.js
const mongoose = require('mongoose');

const candleSchema = new mongoose.Schema(
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

const candlesDataSchema = new mongoose.Schema({
  // add these so index works
  symbol: {
    type: String,
    required: true,
    index: true,
  },
  interval: {
    type: String,
    required: true,
    index: true,
    default: '3m',
  },

  candles: {
    type: [candleSchema],
    default: [],
  },

  // ms timestamp of the last candle close
  lastCloseTime: {
    type: Number,
    default: null,
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

candlesDataSchema.index({ symbol: 1, interval: 1 }, { unique: true });

candlesDataSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('CandlesData', candlesDataSchema);