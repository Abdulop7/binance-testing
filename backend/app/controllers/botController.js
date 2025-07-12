const axios = require("axios");
const Binance = require("node-binance-api");
const { model } = require("mongoose");
const botrunner = require("../../botrunner");
const BotStatus = require('../models/botStatus')
const TradeHistory = require("../models/tradeHistory");
const { ATR } = require('technicalindicators');
const NewsEvent = require("../models/newsEvent");
const Trade = require("../models/trade");
const binance = new Binance().options({
    APIKEY: process.env.apiKey,
    APISECRET: process.env.secretKey
});

let activeTrade = null;

async function getAtr(req, res) {

    const { ohlcv } = await botrunner.fetchCandles();

    if (!Array.isArray(ohlcv) || ohlcv.length < 14) {
        return res.status(400).json({ status: 0, msg: "Not enough data for ATR calculation" });
    }
    else {

        const highs = ohlcv.map(c => c.high);
        const lows = ohlcv.map(c => c.low);
        const closes = ohlcv.map(c => c.closes);

        const atr = ATR.calculate({
            period: 14, // or your desired length
            high: highs,
            low: lows,
            close: closes
        });

        const latestATR = atr[atr.length - 1];
        res.json({ atr: Number(latestATR.toFixed(4)) });
    }
}

async function ViewPrice(req, res) {
    try {
        const Fprice = await getPrice();
        res.json({ Fprice }); // Returns: { "price": 0.5432 }
    } catch (err) {
        console.error("❌ Failed to fetch Live price:", err.message);
        res.status(500).json({ error: "Failed to fetch live price" });
    }
}


async function getPrice(){

    let response = await axios.get(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${process.env.symbol}`);
    let price = response.data.price
    let Fprice = Math.round(price * 10000) / 10000;
    return Fprice
}


async function morecandleFetch(req, res) {

    let qty = req.query.qty;
    let symbol = req.query.symbol;
    let tf = req.query.tf;
    let candleQty = qty / 1000



    let allCloses = [];
    let endTime = Date.now();

    for (let i = 0; i < candleQty; i++) { // 20 * 1000 = 20,000 candles
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}m&limit=1000&endTime=${endTime}`;
        const { data } = await axios.get(url);
        if (!data.length) break;

        const closes = data.map(candle => parseFloat(candle[4]));
        allCloses = [...closes, ...allCloses];
        endTime = data[0][0] - 1;
    }

    res.send({
        closes: allCloses
    })
}

async function getEma(req, res) {
    const result = await botrunner.calculateEmaSignal();
    res.send(result);
}


function clearOldBacktest() {
    // Clear previous data
    trades = [];
    equityCurve = [];
}


async function doBacktest(req, res) {
    let capital = parseFloat(req.query.capital);
    let positionSize = parseFloat(req.query.pSize);
    let qty = parseFloat(req.query.qty);
    let symbol = req.query.symbol;
    let tf = req.query.tf;
    let emaQuery = req.query.ema; // "5,8,13,200"
    let emaPeriods = emaQuery.split(',').map(Number); // [5, 8, 13, 200]

    // Sort EMAs in descending for consistent logic
    emaPeriods.sort((a, b) => b - a);

    // Fetch close prices
    let response = await axios.get(`https://binance-backend-6n65.onrender.com/bot/more-fetch?qty=${qty}&symbol=${symbol}&tf=${tf}`); // Web APi URL here
    let { closes } = response.data;

    clearOldBacktest()

    // Compute all EMAs dynamically
    let emaMap = {};
    for (let period of emaPeriods) {
        emaMap[period] = EMA.calculate({ period, values: closes });
    }

    let trades = [];
    let inPosition = false;
    let entryPrice = 0;
    let tradeType = null;
    let totalProfit = 0;
    let wins = 0, losses = 0;
    let equity = capital;
    let equityCurve = [];

    const maxPeriod = Math.max(...emaPeriods);

    for (let i = maxPeriod; i < closes.length; i++) {
        const price = closes[i];

        // Extract EMAs for this index
        let emaValues = emaPeriods.map(period => {
            const offset = i - (maxPeriod - period);
            return emaMap[period][offset];
        });

        // Check if sorted (Buy: descending, Sell: ascending)
        const isBuySignal = emaValues.every((val, idx, arr) => idx === 0 || arr[idx - 1] > val);
        const isSellSignal = emaValues.every((val, idx, arr) => idx === 0 || arr[idx - 1] < val);


        if (!inPosition && (isBuySignal || isSellSignal)) {
            inPosition = true;
            entryPrice = price;
            tradeType = isBuySignal ? "BUY" : "SELL";
            trades.push({ type: tradeType, entryPrice, entryIndex: i });
            continue;
        }

        if (inPosition) {
            const lastTrade = trades[trades.length - 1];

            const tpReached = lastTrade.type === "BUY"
                ? price >= entryPrice * 1.01
                : price <= entryPrice * 0.99;

            const slTriggered = lastTrade.type === "BUY"
                ? emaValues.some(v => v < emaValues[0]) // break in structure
                : emaValues.some(v => v > emaValues[0]);

            if (tpReached || slTriggered) {
                const exitPrice = price;
                const profitPercent = lastTrade.type === "BUY"
                    ? (exitPrice - entryPrice) / entryPrice
                    : (entryPrice - exitPrice) / entryPrice;

                const profitDollars = profitPercent * positionSize;
                totalProfit += profitDollars;
                equity += profitDollars;
                equityCurve.push(equity);

                if (profitDollars > 0) wins++;
                else losses++;

                lastTrade.exitPrice = exitPrice;
                lastTrade.exitIndex = i;
                lastTrade.profit = profitDollars.toFixed(2) + " USD";
                lastTrade.result = profitDollars > 0 ? "Win" : "Loss";

                inPosition = false;
            }
        }
    }

    // Max Drawdown
    let peak = capital;
    let maxDrawdownDollar = 0;
    for (let value of equityCurve) {
        if (value > peak) peak = value;
        const drawdown = peak - value;
        if (drawdown > maxDrawdownDollar) maxDrawdownDollar = drawdown;
    }

    const result = {
        emaPeriods,
        totalTrades: trades.length,
        wins,
        losses,
        winRate: trades.length > 0 ? ((wins / trades.length) * 100).toFixed(2) + "%" : "0%",
        totalProfit: totalProfit.toFixed(2) + " USD",
        finalCapital: (capital + totalProfit).toFixed(2) + " USD",
        maxDrawdownDollar: maxDrawdownDollar.toFixed(2) + " USD",
        trades,
    };

    res.json(result);
}

async function placeOrder(req, res) {

    let signal = req.query.signal
    let positionSize = req.query.qty

    if (signal === "BUY") {

        const buy = await binance.marketBuy(symbol, quantity);
        return res.json({ code: 1, status: "Buy order placed", details: buy });

    } else if (signal === "SELL") {

        const sell = await binance.marketSell(symbol, quantity);
        return res.json({ dode: 1, status: "Sell order placed", details: sell });

    } else {

        return res.status(400).json({ status: 0, error: "Invalid signal type" });

    }

}

async function getBotStatus(req, res) {
    try {
        const status = await BotStatus.findOne(); // assuming single bot
        if (!status) return res.status(404).json({ msg: "No status found" });
        res.json(status);
    } catch (err) {
        res.status(500).json({ msg: "Server error", error: err });
    }

}

async function updBotStatus(req, res) {
    const { isActive, lastSignal, inTrade } = req.body; // ✅ Accept inTrade from request

    try {
        let status = await BotStatus.findOne();

        if (!status) {
            status = new BotStatus({
                isActive,
                lastSignal: lastSignal,
                inTrade: inTrade,
                startedAt: isActive ? new Date() : null,
            });
        } else {
            status.isActive = isActive;
            status.startedAt = isActive ? new Date() : null;

            if (lastSignal !== undefined) {
                status.lastSignal = lastSignal;
            }

            if (inTrade !== undefined) {
                status.inTrade = inTrade;
            }
        }

        await status.save();
        res.json({ msg: "Bot status updated", status });
    } catch (err) {
        res.status(500).json({ msg: "Update failed", error: err });
    }
}

async function StartBot(req, res) {
    console.log("StartBot function called");

    try {
        const status = await BotStatus.findOne();

        if (status?.isActive) {
            return res.status(400).json({ message: "Bot is already active" });
        }


        // 🧠 Then trigger async bot start

        await botrunner.startBot();

        res.json({ message: "Bot Started" });

    } catch (err) {
        console.error("StartBot error:", err.message);
        if (!res.headersSent) {
            res.status(500).json({ message: "Failed to start bot" });
        }
    }
}


async function StopBot(req, res) {

    console.log("Stop Function is Running");

    const status = await BotStatus.findOne();

    if (!status?.isActive) {
        return res.status(400).json({ message: "Bot already stopped" });
    }

    await botrunner.stopBot();
    res.json({ message: "Bot stopped" });

}

async function SaveTrade(req, res) {

    const { signal, time, price, positionSize, positionSizeUSD, leverage, candleTimestamp } = req.body;
    activeTrade = {
        entryTime: time,
        entryPrice: price,
        type: signal,
        positionSize: positionSize,
        positionSizeUSD: positionSizeUSD,
        leverage: leverage,
        candleTimestamp
    };
    try {
        const newTrade = new Trade(activeTrade);
        await newTrade.save();

        res.json({ message: "Trade saved successfully", activeTrade });
        console.log({ message: "Trade saved successfully ✅", activeTrade });
    } catch (err) {
        console.error("Error saving trade:", err);
        res.status(500).json({ message: "Failed to save trade", error: err.message });
    }

}


async function GetActiveTrades(req, res) {

    try {
        // Find the most recent trade (based on entryTime or _id)
        const latestTrade = await Trade.findOne().sort({ entryTime: -1 }); // or sort({ _id: -1 })

        if (!latestTrade) {
            return res.status(404).json({ message: "No active trade found" });
        }

        res.json(latestTrade);
    } catch (error) {
        console.error("Error fetching active trade:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
}


async function ClearTrade(req, res) {

    try {
        // Find and delete the most recent trade (assuming latest is the active one)
        const deletedTrade = await Trade.findOneAndDelete({}, { sort: { entryTime: -1 } }); // or sort: { _id: -1 }

        if (!deletedTrade) {
            return res.status(404).json({ message: "No active trade found to delete" });
        }

        res.json({ message: "Active trade cleared from database", deletedTrade });
        console.log("✅ Active trade cleared:", deletedTrade);
    } catch (error) {
        console.error("❌ Error clearing trade:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }

}

async function SaveHistory(req, res) {

    const { tradeNumber, profit, time, type, positionSize, positionSizeUSD, leverage, entryPrice } = req.body;

    const history = new TradeHistory({
        tradeNumber,
        entryPrice,
        profit,
        time: time || new Date(),
        type: type,
        positionSize: positionSize,
        positionSizeUSD: positionSizeUSD,
        leverage: leverage
    });

    await history.save();

    res.status(200).json({ success: true, message: "Trade saved" });

}

async function AllTrades(req, res) {

    let trades = await TradeHistory.find().sort({ createdAt: -1 })
    res.json(trades)
}

async function TradeNumber(req, res) {

    const latestTrade = await TradeHistory.findOne().sort({ tradeNumber: -1 });
    const tradeNumber = latestTrade ? latestTrade.tradeNumber : 0;
    res.json({ tradeNumber });


}

async function checkNewsBlock(req, res) {
    const now = new Date();
    const event = await NewsEvent.findOne({
        stopTime: { $lte: now },
        resumeTime: { $gte: now }
    });

    if (event) {
        return res.json({ blocked: true, reason: event.type, resumeAt: event.resumeTime });
    } else {
        return res.json({ blocked: false });
    }
}


async function addNewsEvent(req, res) {
    const { type, date } = req.body;
    const newsDate = new Date(date); // news time e.g., 2025-06-27T14:30:00Z

    let stopTime, resumeTime;
    if (type === "NFP" || type === "CPI") {
        stopTime = new Date(newsDate.getTime() - 2.5 * 60 * 60 * 1000); // 06:00
        resumeTime = new Date(newsDate.getTime() + 2.5 * 60 * 60 * 1000); // 11:00
    } else if (type === "FOMC") {
        stopTime = new Date(newsDate.getTime() - 1.5 * 60 * 60 * 1000); // 13:00
        resumeTime = new Date(newsDate.getTime() + 1.5 * 60 * 60 * 1000); // 16:00
    } else if (type === "FED_SPEAK") {
        stopTime = new Date(newsDate.getTime() - 1 * 60 * 60 * 1000); // 09:00
        resumeTime = new Date(newsDate.getTime() + 2 * 60 * 60 * 1000); // 12:00
    }

    const newEvent = new NewsEvent({ type, date: newsDate, stopTime, resumeTime });
    await newEvent.save();
    res.json({ msg: "News event added", newEvent });
}

async function showNews(req, res) {
    const newsEvents = await NewsEvent.find().sort({ date: 1 }); // Optional: filter for future only
    res.json(newsEvents);
}

module.exports = { placeOrder, doBacktest, ViewPrice, getEma, morecandleFetch, getBotStatus, updBotStatus, StartBot, StopBot, SaveTrade, GetActiveTrades, ClearTrade, SaveHistory, AllTrades, getAtr, TradeNumber, addNewsEvent, checkNewsBlock, showNews,getPrice }
