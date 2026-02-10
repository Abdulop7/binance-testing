const mongoose = require("mongoose");
let Schema = mongoose.Schema;

let tradeCandlesSchema = new Schema({
    candleCloses: {
        type: [Number], // Array of close prices
        default: []
    },

}, { timestamps: true })

let statusModel = mongoose.model("TradeCandles", tradeCandlesSchema)

module.exports = statusModel