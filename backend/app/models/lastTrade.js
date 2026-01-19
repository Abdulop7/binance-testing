const mongoose = require("mongoose");
let Schema =mongoose.Schema;

let lastTradeSchema = new Schema({
    lastTradeSignal:{
        type:String,
        Default:null
    },
    LastTradeTime:{
        type:Date,
        Default:null
    },
    lastTradePrice:{
        type:Number,
        default:null
    },
    lastTradeObjectId:{
        type:String,
        default : null
    }
    
}, {timestamps:true})

let statusModel= mongoose.model("LastTrade", lastTradeSchema)

module.exports = statusModel