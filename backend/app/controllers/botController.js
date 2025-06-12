const axios = require("axios");
const { EMA } = require("technicalindicators");
const Binance = require("node-binance-api");
const { model } = require("mongoose");
const botrunner = require("../../botrunner");
const BotStatus = require('../models/botStatus')
const TradeHistory = require("../models/tradeHistory");
const binance = new Binance().options({
    APIKEY: process.env.apiKey,
    APISECRET: process.env.secretKey
});

let activeTrade = null;

async function ViewPrice(req, res) {
    let response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${process.env.symbol}`);
    let price = response.data.price
    let Fprice = Math.round(price * 100) / 100;
    res.json(Fprice)
}
async function candlesFetch(req, res) {
    try {

        let url = `https://api.binance.com/api/v3/klines?symbol=SUIUSDT&interval=3m&limit=1000`
        let { data } = await axios.get(url)
        let closes = data.map(candle => parseFloat(candle[4]));
        res.json({ closes })
    }
    catch (err) {
        res.send({
            status: 0,
            msg: err
        })
    }
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
    try{
    
    let response = await axios.get("https://binance-backend-6n65.onrender.com/bot/fetch"); // Web APi URL here

    let data = response.data.closes;

    const ema9 = EMA.calculate({ period: 8, values: data });
    const ema21 = EMA.calculate({ period: 13, values: data });
    const ema50 = EMA.calculate({ period: 21, values: data });
    const ema200 = EMA.calculate({ period: 55, values: data });

    const last9 = ema9[ema9.length - 1];
    const last21 = ema21[ema21.length - 1];
    const last50 = ema50[ema50.length - 1];
    const last200 = ema200[ema200.length - 1];

    let signal = "WAIT"; // Try to Remove the Wait
    if (last9 > last21 && last21 > last50 && last50 > last200) {
        signal = "BUY";
    } else if (last9 < last21 && last21 < last50 && last50 < last200) {
        signal = "SELL";
    }

    res.send({
        status: 1,
        msg: {
            ema9: last9,
            ema21: last21,
            ema50: last50,
            ema200: last200,
            signal
        }
    })
    }
    catch(err){
        console.log({status:0, msg :err});
        
    }
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
                lastSignal: lastSignal ,
                inTrade: inTrade ,
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

    const { signal, time, price,positionSize,positionSizeUSD,leverage} = req.body;
    activeTrade = {
        entryTime: time,
        entryPrice: price,
        type: signal,
        positionSize:positionSize,
        positionSizeUSD: positionSizeUSD,
        leverage:leverage
    };
    res.json({ message: "Trade saved successfully", activeTrade });
    console.log({ message: "Trade saved successfully ✅", activeTrade });
    
}

async function GetActiveTrades(req, res) {

    if (!activeTrade) return res.status(404).json({ message: "No active trade" });
    res.json(activeTrade);
}


async function ClearTrade(req, res) {

    activeTrade = null;
    res.json({ message: "Active trade cleared" });

}

async function SaveHistory(req,res){

    const { tradeNumber, profit, time,type, positionSize, positionSizeUSD, leverage,entryPrice } = req.body;

    const history = new TradeHistory({
      tradeNumber,
      entryPrice,
      profit,
      time: time || new Date(),
      type:type,
      positionSize:positionSize,
      positionSizeUSD:positionSizeUSD,
      leverage:leverage
    });

    await history.save();

    res.status(200).json({ success: true, message: "Trade saved" });

}

module.exports = { placeOrder, doBacktest, ViewPrice, getEma, morecandleFetch, candlesFetch, getBotStatus, updBotStatus, StartBot, StopBot, SaveTrade, GetActiveTrades, ClearTrade,SaveHistory }
