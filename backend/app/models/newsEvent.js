const mongoose = require("mongoose");

const newsEventSchema = new mongoose.Schema({
  type: { type: String, enum: ["FOMC", "NFP", "CPI", "FED_SPEAK"], required: true },
  date: { type: Date, required: true }, // actual news time (e.g., 2025-06-27T14:30:00Z)
  stopTime: { type: Date, required: true },
  resumeTime: { type: Date, required: true }
});

module.exports = mongoose.model("NewsEvent", newsEventSchema);
