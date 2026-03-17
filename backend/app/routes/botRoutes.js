const express = require("express");
const {  doBacktest, getEma, morecandleFetch, ViewPrice, getBotStatus, updBotStatus, StartBot, StopBot, SaveTrade, GetActiveTrades, ClearTrade, SaveHistory,AllTrades, getAtr, TradeNumber, addNewsEvent, checkNewsBlock, showNews, subscribe, updLastTrade, getLastTrade, UpdateTradeHistoryMFE, getTradeCandles, addTradeCandleClose, clearAllTradeCandles, getCandlesData, addCandlesData, delCandlesData, updatePartial } = require("../controllers/botController");
const { getFuturesBalance } = require("../../botrunner");

let BotRouter = express.Router()

BotRouter.get("/view", ViewPrice)

BotRouter.get("/more-fetch", morecandleFetch)

BotRouter.get("/ema", getEma)

BotRouter.get("/backtest", doBacktest)

BotRouter.get("/status",getBotStatus)

BotRouter.get("/get-last",getLastTrade)

BotRouter.post("/status",updBotStatus)

BotRouter.post("/upd-history",UpdateTradeHistoryMFE)

BotRouter.post("/save-last",updLastTrade)

BotRouter.post("/start-bot",StartBot)

BotRouter.post("/stop-bot",StopBot)

BotRouter.post("/save-trade", SaveTrade)

BotRouter.post("/upd-partial", updatePartial)

BotRouter.get("/get-trade", GetActiveTrades)

BotRouter.post("/clear-trade", ClearTrade)

BotRouter.post("/save-history", SaveHistory)

BotRouter.get("/all-trades", AllTrades)

BotRouter.get("/trade-candles", getTradeCandles)

BotRouter.post("/trade-candles", addTradeCandleClose)

BotRouter.delete("/trade-candles", clearAllTradeCandles)

BotRouter.get("/candles-data", getCandlesData)

BotRouter.post("/candles-data", addCandlesData)

BotRouter.delete("/candles-data", delCandlesData)

BotRouter.get("/atr", getAtr)

BotRouter.get("/last-trade", TradeNumber)

BotRouter.post("/add-news", addNewsEvent)

BotRouter.get("/get-news", checkNewsBlock)

BotRouter.get("/show-news", showNews)

BotRouter.get("/get-balance", getFuturesBalance)

BotRouter.post("/subscribe", subscribe)


module.exports = BotRouter;