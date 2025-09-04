const express = require("express");
const {  doBacktest, getEma, morecandleFetch, placeOrder, ViewPrice, getBotStatus, updBotStatus, StartBot, StopBot, SaveTrade, GetActiveTrades, ClearTrade, SaveHistory,AllTrades, getAtr, TradeNumber, addNewsEvent, checkNewsBlock, showNews, subscribe } = require("../controllers/botController");
const { getFuturesBalance } = require("../../botrunner");

let BotRouter = express.Router()

BotRouter.get("/view", ViewPrice)

BotRouter.get("/more-fetch", morecandleFetch)

BotRouter.get("/ema", getEma)

BotRouter.get("/backtest", doBacktest)

BotRouter.post("/place-order",placeOrder)

BotRouter.get("/status",getBotStatus)

BotRouter.post("/status",updBotStatus)

BotRouter.post("/start-bot",StartBot)

BotRouter.post("/stop-bot",StopBot)

BotRouter.post("/save-trade", SaveTrade)

BotRouter.get("/get-trade", GetActiveTrades)

BotRouter.post("/clear-trade", ClearTrade)

BotRouter.post("/save-history", SaveHistory)

BotRouter.get("/all-trades", AllTrades)

BotRouter.get("/atr", getAtr)

BotRouter.get("/last-trade", TradeNumber)

BotRouter.post("/add-news", addNewsEvent)

BotRouter.get("/get-news", checkNewsBlock)

BotRouter.get("/show-news", showNews)

BotRouter.get("/get-balance", getFuturesBalance)

BotRouter.post("/subscribe", subscribe)


module.exports = BotRouter;