const axios = require("axios");

const botrunner = require("../../botrunner");
const BotStatus = require('../models/botStatus')
const LastTrade = require('../models/lastTrade')
const TradeCandles = require('../models/tradeCandles')
const TradeHistory = require("../models/tradeHistory");
const { ATR } = require('technicalindicators');
const NewsEvent = require("../models/newsEvent");
const CandlesData = require("../models/candlesData");
const Trade = require("../models/trade");
const { getLatestCandle } = require("../../binanceWebSocket");

const ALLOWED_ENDPOINTS = new Set([
    "/fapi/v2/account",        // getBalance
    "/fapi/v2/balance",        // getBalance
    "/fapi/v1/order",          // placeFuturesOrder
    "/fapi/v1/leverage",       // setLeverage
    "/fapi/v1/marginType",     // setMarginType
    "/fapi/v1/algoOrder",      // futuresPlaceStopMarket
]);

const ALLOWED_METHODS = new Set(["GET", "POST", "DELETE"]);
let activeTrade = null;

async function getAtr(req, res) {

    const { ohlcv } = await getLatestCandle();

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
        const Fprice = await botrunner.getPrice();
        res.json({ Fprice }); // Returns: { "price": 0.5432 }
    } catch (err) {
        console.error("❌ Failed to fetch Live price:", err.message);
        res.status(500).json({ error: "Failed to fetch live price" });
    }
}



async function morecandleFetch(req, res) {
    let qty = parseInt(req.query.qty); // total candles wanted
    let symbol = req.query.symbol;
    let tf = req.query.tf;

    let allCandles = [];
    let endTime = Date.now();

    while (allCandles.length < qty) {
        // fetch remaining candles up to 1000
        const limit = Math.min(1000, qty - allCandles.length);
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}m&limit=${limit}&endTime=${endTime}`;
        const { data } = await axios.get(url);
        if (!data.length) break;

        const candles = data.map(c => ({
            openTime: c[0],
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5]),
            closeTime: c[6],
            quoteAssetVolume: parseFloat(c[7]),
            numberOfTrades: c[8],
            takerBuyBase: parseFloat(c[9]),
            takerBuyQuote: parseFloat(c[10])
        }));

        allCandles = [...candles, ...allCandles];
        endTime = data[0][0] - 1; // move to previous batch
    }

    res.send({ candles: allCandles });
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
    let response = await axios.get(`${process.env.backendURL}/bot/more-fetch?qty=${qty}&symbol=${symbol}&tf=${tf}`,
        {
            headers: {
                Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
            }
        }); // Web APi URL here
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


async function getBotStatus(req, res) {
    try {
        const status = await BotStatus.findOne(); // assuming single bot
        if (!status) return res.status(404).json({ msg: "No status found" });
        res.json(status);
    } catch (err) {
        res.status(500).json({ msg: "Server error", error: err });
    }

}

async function getLastTrade(req, res) {

    try {
        const status = await LastTrade.findOne(); // assuming single bot
        if (!status) return res.status(404).json({ msg: "No status found" });
        res.json(status);
    } catch (err) {
        res.status(500).json({ msg: "Server error", error: err });
    }

}

async function getTradeCandles(req, res) {
    try {
        // Find the single document (or create if doesn't exist)
        let candles = await TradeCandles.findOne({});

        if (!candles) {
            // Create empty document if none exists
            candles = new TradeCandles({ candleCloses: [] });
            await candles.save();
        }

        res.status(200).json({
            success: true,
            candleCloses: candles.candleCloses,
            totalCandles: candles.candleCloses.length,
            updatedAt: candles.updatedAt
        });
    } catch (err) {
        console.error("Get all candles error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

async function getCandlesData(req, res) {
    try {
        const symbol = process.env.symbol;            // or req.query.symbol
        const interval = req.query.interval || '3m';

        let doc = await CandlesData.findOne({ symbol, interval }).lean();

        if (!doc) {
            return res.json({
                success: true,
                symbol,
                interval,
                candles: [],
                totalCandles: 0,
                lastCloseTime: null,
            });
        }

        return res.json({
            success: true,
            symbol,
            interval,
            candles: doc.candles,
            totalCandles: doc.candles.length,
            lastCloseTime: doc.lastCloseTime,
        });
    } catch (err) {
        console.error('GET /candles-data error:', err.message);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
}

async function addCandlesData(req, res) {
    try {
        const symbol = process.env.symbol;
        const interval = req.body.interval || '3m';
        const candle = req.body.candle;
        const MAX_LEN = 100;

        if (
            !candle ||
            typeof candle.openTime !== 'number' ||
            typeof candle.closeTime !== 'number'
        ) {
            return res.status(400).json({ success: false, msg: 'Invalid candle' });
        }

        const doc = await CandlesData.findOneAndUpdate(
            { symbol, interval },
            {
                $push: {
                    candles: {
                        $each: [candle],
                        $slice: -MAX_LEN,   // keep last MAX_LEN candles
                    },
                },
                $set: {
                    lastCloseTime: candle.closeTime,
                },
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            symbol,
            interval,
            totalCandles: doc.candles.length,
            lastCloseTime: doc.lastCloseTime,
        });
    } catch (err) {
        console.error('POST /candles-data error:', err.message);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
}

async function delCandlesData(req, res) {

    try {
        const symbol = process.env.symbol;
        const interval = req.query.interval || '3m';

        await CandlesData.findOneAndUpdate(
            { symbol, interval },
            { $set: { candles: [], lastCloseTime: null } },
            { upsert: true }
        );

        res.json({ success: true, msg: 'All candles cleared.' });
    } catch (err) {
        console.error('DELETE /candles-data error:', err.message);
        res.status(500).json({ success: false, msg: 'Server error' });
    }

}

async function addTradeCandleClose(req, res) {
    try {
        const { closePrice } = req.body;

        // Validate input
        if (closePrice === undefined || closePrice === null) {
            return res.status(400).json({
                success: false,
                error: "closePrice is required"
            });
        }

        // Validate it's a number
        const price = parseFloat(closePrice);
        if (isNaN(price)) {
            return res.status(400).json({
                success: false,
                error: "closePrice must be a valid number"
            });
        }

        // Find existing document or create new one, then push the candle close
        let candles = await TradeCandles.findOne({});

        if (!candles) {
            // Create new document with first candle
            candles = new TradeCandles({ candleCloses: [price] });
        } else {
            // Push to existing array
            candles.candleCloses.push(price);
        }

        await candles.save();

        res.status(200).json({
            success: true,
            message: "Candle close added",
            addedPrice: price,
            totalCandles: candles.candleCloses.length
        });
    } catch (err) {
        console.error("Add candle close error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

async function clearAllTradeCandles(req, res) {
    try {
        let candles = await TradeCandles.findOne({});

        if (!candles) {
            candles = new TradeCandles({ candleCloses: [] });
        } else {
            candles.candleCloses = [];
        }

        await candles.save();

        res.status(200).json({
            success: true,
            message: "All candle closes cleared",
            totalCandles: 0
        });
    } catch (err) {
        console.error("Clear candles error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

async function updBotStatus(req, res) {
    const { isActive, lastSignal, inTrade } = req.body;

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

            // ✅ Only update if provided
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

async function updLastTrade(req, res) {

    const { LastTradeTime, lastTradeSignal, lastTradePrice, lastTradeObjectId } = req.body;

    try {
        let status = await LastTrade.findOne();

        if (!status) {
            status = new LastTrade({
                LastTradeTime: LastTradeTime, // ✅ Initialize if provided
                lastTradeSignal: lastTradeSignal, // ✅ Initialize if provided
                lastTradePrice: lastTradePrice, // ✅ Initialize if provided
                lastTradeObjectId: lastTradeObjectId, // ✅ Initialize if provided
            });
        } else {

            // ✅ Only update LastTradeTime if provided
            if (LastTradeTime !== undefined) {
                status.LastTradeTime = LastTradeTime;
            }

            // ✅ Only update lastTradeSignal if provided
            if (lastTradeSignal !== undefined) {
                status.lastTradeSignal = lastTradeSignal;
            }

            if (lastTradePrice !== undefined) {
                status.lastTradePrice = lastTradePrice;
            }

            if (lastTradeObjectId !== undefined) {
                status.lastTradeObjectId = lastTradeObjectId;
            }
        }

        await status.save();
        res.json({ msg: "Last Trade updated", status });
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

    const { signal, time, price, positionSize, positionSizeUSD, slope, leverage, candleTimestamp, atr, real, slPrice, partialTpPrice, tpPrice, slOrderId, tp1OrderId, tp2OrderId } = req.body;
    activeTrade = {
        entryTime: time,
        entryPrice: price,
        atr: atr,
        real: real,
        slope: slope,
        type: signal,
        positionSize: positionSize,
        positionSizeUSD: positionSizeUSD,
        leverage: leverage,
        candleTimestamp,
        slPrice,
        partialTpPrice,
        tpPrice,
        slOrderId,
        tp1OrderId,
        tp2OrderId
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

    const { tradeNumber, profit, time, type, positionSize, atr, positionSizeUSD, slope, leverage, entryPrice, bot, tpPrice, partialTpPrice, slPrice, exitPrice, partialTPHit } = req.body;

    const history = new TradeHistory({
        bot,
        tradeNumber,
        entryPrice,
        atr,
        slope,
        profit,
        time: time || new Date(),
        type: type,
        positionSize: positionSize,
        positionSizeUSD: positionSizeUSD,
        leverage: leverage, 
        tpPrice, 
        partialTpPrice, 
        slPrice, 
        exitPrice, 
        partialTPHit
    });
    await history.save();

    // Get the inserted document's _id
    const tradeId = history._id;

    console.log(`Trade Id sending Via Save History is = ${tradeId}`);


    res.status(200).json({ success: true, message: "Trade saved", tradeId: tradeId.toString() });

}

async function UpdateTradeHistoryMFE(req, res) {
    try {
        const { tradeId, mfe, mae, mfePercent, maePercent } = req.body;

        // ✅ Find and update the trade by ObjectId
        const updatedTrade = await TradeHistory.findByIdAndUpdate(
            tradeId,
            {
                $set: {
                    mfe: mfe ?? null,
                    mae: mae ?? null,
                    mfePercent: mfePercent ?? null,
                    maePercent: maePercent ?? null
                }
            },
            {
                new: true, // Return the updated document
                runValidators: true // Run schema validators
            }
        );

        // ✅ Check if trade was found
        if (!updatedTrade) {
            return res.status(404).json({
                success: false,
                message: "Trade not found with the provided ID"
            });
        }

        res.status(200).json({
            success: true,
            message: "Trade updated with MFE/MAE data",
            trade: updatedTrade
        });

    } catch (err) {
        console.error("Error updating trade history:", err);
        res.status(500).json({
            success: false,
            message: "Failed to update trade",
            error: err.message
        });
    }
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

async function subscribe(req, res) {
    const subscription = req.body;
    botrunner.saveSubscription(subscription);
    res.status(201).json({});
}

async function updatePartial(req, res) {
    try {
        const symbol = process.env.symbol;
        const { positionSize, positionSizeUSD, closedProfit, slOrderId } = req.body;

        const trade = await Trade.findOne().sort({ entryTime: -1 });

        if (!trade) {
            return res.status(404).json({ success: false, msg: 'No active trade' });
        }

        trade.positionSize = positionSize;
        trade.positionSizeUSD = positionSizeUSD;
        trade.realizedProfit = (trade.realizedProfit) + (closedProfit);
        trade.slOrderId = String(slOrderId);

        await trade.save();

        res.json({
            success: true,
            realizedProfit: trade.realizedProfit,
            positionSize: trade.positionSize,
            positionSizeUSD: trade.positionSizeUSD,
            slOrderId: trade.slOrderId
        });
    } catch (err) {
        console.error('POST /bot/update-trade-partial error:', err.message);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
}

async function exec(req, res) {
    try {
        const body = req.body || {};
        const {
            provider,      // "binance-futures"
            signed,        // true
            method,        // "GET" | "POST" | "DELETE"
            endpoint,      // "/fapi/v1/order"
            params = {},   // object
        } = body;

        // --- Validate payload ---
        if (provider !== "binance-futures") {
            return res.status(400).json({ ok: false, error: "Unsupported provider" });
        }

        const m = String(method || "").toUpperCase();
        if (!ALLOWED_METHODS.has(m)) {
            return res.status(400).json({ ok: false, error: "Method not allowed" });
        }

        if (!endpoint || !endpoint.startsWith("/fapi/")) {
            return res.status(400).json({ ok: false, error: "Bad endpoint" });
        }

        if (!ALLOWED_ENDPOINTS.has(endpoint)) {
            return res.status(403).json({ ok: false, error: "Endpoint not allowed" });
        }

        if (signed !== true) {
            return res.status(400).json({ ok: false, error: "Only signed=true supported" });
        }

        // --- Route to your existing helpers ---
        let result;
        switch (m) {
            case "GET":
                result = await botrunner.futuresGetSigned(endpoint, params);
                break;
            case "POST":
                result = await botrunner.futuresPostSigned(endpoint, params);
                break;
            case "DELETE":
                result = await botrunner.futuresDeleteSigned(endpoint, params);
                break;
            default:
                return res.status(400).json({ ok: false, error: "Method not supported" });
        }

        // --- Success: return Binance response.data ---
        return res.json(result);

    } catch (err) {
        // --- Forward Binance errors exactly as they come ---
        const status = err?.response?.status || 500;
        const binanceError = err?.response?.data || { msg: err.message };

        return res.status(status).json({
            ok: false,
            status,
            binance: binanceError,
        });
    }
}

module.exports = { UpdateTradeHistoryMFE, getLastTrade, updLastTrade, doBacktest, ViewPrice, getEma, morecandleFetch, getBotStatus, updBotStatus, StartBot, StopBot, SaveTrade, GetActiveTrades, ClearTrade, SaveHistory, AllTrades, getAtr, TradeNumber, addNewsEvent, checkNewsBlock, showNews, subscribe, getTradeCandles, addTradeCandleClose, clearAllTradeCandles, getCandlesData, addCandlesData, delCandlesData, updatePartial, exec }
