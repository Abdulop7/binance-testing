const mongoose = require("mongoose");
let Schema =mongoose.Schema;

let botStatusSchema = new Schema({
    isActive:{
        type:Boolean,
        default:false
    },
    startedAt:{
        type:Date
    },
    lastSignal:{
        type:String,
        default:null
    },
    inTrade:{
        type:Boolean,
        default:false
    }
}, {timestamps:true})

let statusModel= mongoose.model("BotStatus", botStatusSchema)

module.exports = statusModel