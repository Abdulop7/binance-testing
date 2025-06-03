const axios = require("axios");
const { EMA } = require("technicalindicators");
const Binance = require("node-binance-api");
const { model } = require("mongoose");
const botrunner = require("../../botrunner");
const BotStatus = require('../models/botStatus')
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

        let url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=3m&limit=1000`
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
    let candleQty = qty / 1000

    

    let allCloses = [];
    let endTime = Date.now();

    for (let i = 0; i < candleQty; i++) { // 20 * 1000 = 20,000 candles
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=3m&limit=1000&endTime=${endTime}`;
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
    let response = await axios.get("http://localhost:100/bot/fetch");

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
    if (last200 < last50 && last200 < last21 && last200 < last9) {
        signal = "BUY";
    } else if (last200 > last50 && last200 > last21 && last200 > last9) {
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

async function doBacktest(req, res) {
    let capital = parseFloat(req.query.capital); // in $
    let positionSize = parseFloat(req.query.pSize); // in $ 
    let qty = parseFloat(req.query.qty);
    let symbol = req.query.symbol;
    

    let response = await axios.get(`http://localhost:100/bot/more-fetch?qty=${qty}&symbol=${symbol}`)
    let { closes } = response.data
    

    // Calculate EMAs
    const ema8 = EMA.calculate({ period: 8, values: closes });
    const ema13 = EMA.calculate({ period: 13, values: closes });
    const ema21 = EMA.calculate({ period: 21, values: closes });
    const ema55 = EMA.calculate({ period: 55, values: closes });

    // Backtest logic
    let trades = [];
    let inPosition = false;
    let entryPrice = 0;
    let tradeType = null;
    let totalProfit = 0;
    let wins = 0,
        losses = 0;
    let equity = capital;
    let equityCurve = [];

    const maxPeriod = 55; // Start from index where all EMAs are valid

    for (let i = maxPeriod; i < closes.length; i++) {
        const price = closes[i];

        const e8 = ema8[i - (maxPeriod - 8)];
        const e13 = ema13[i - (maxPeriod - 13)];
        const e21 = ema21[i - (maxPeriod - 21)];
        const e55 = ema55[i - maxPeriod];

        const isBuySignal = e55 < e21 && e21 < e13 && e13 < e8;
        const isSellSignal = e55 > e21 && e21 > e13 && e13 > e8;

        if (!inPosition && (isBuySignal || isSellSignal)) {
            inPosition = true;
            entryPrice = price;
            tradeType = isBuySignal ? "BUY" : "SELL";
            trades.push({ type: tradeType, entryPrice, entryIndex: i });
            continue;
        }

        if (inPosition) {
            const lastTrade = trades[trades.length - 1];

            const tpReached =
                lastTrade.type === "BUY"
                    ? price >= entryPrice * 1.01
                    : price <= entryPrice * 0.99;

            const slTriggered =
                (lastTrade.type === "BUY" &&
                    (e55 > e21 || e55 > e13 || e55 > e8)) ||
                (lastTrade.type === "SELL" &&
                    (e55 < e21 || e55 < e13 || e55 < e8));


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

    // Calculate Max Drawdown in Dollars
    let peak = capital;
    let maxDrawdownDollar = 0;
    for (let value of equityCurve) {
        if (value > peak) peak = value;
        const drawdown = peak - value;
        if (drawdown > maxDrawdownDollar) maxDrawdownDollar = drawdown;
    }

    const result = {
        totalTrades: trades.length,
        wins,
        losses,
        winRate:
            trades.length > 0
                ? ((wins / trades.length) * 100).toFixed(2) + "%"
                : "0%",
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
    const { isActive, lastSignal } = req.body; // <-- Accept lastSignal
    try {
        let status = await BotStatus.findOne();

        if (!status) {
            status = new BotStatus({ isActive, startedAt: isActive ? new Date() : null });
        } else {
            status.isActive = isActive;
            status.startedAt = isActive ? new Date() : null;

            if (lastSignal !== undefined) {
                status.lastSignal = lastSignal; // <-- Only update if provided
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

    const { signal, time, price } = req.body;
    activeTrade = {
        entryTime: time,
        entryPrice: price,
        type: signal,
    };
    res.json({ message: "Trade saved successfully", activeTrade });
}

async function GetActiveTrades(req, res) {

    if (!activeTrade) return res.status(404).json({ message: "No active trade" });
    res.json(activeTrade);
}


async function ClearTrade(req, res){

    activeTrade = null;
  res.json({ message: "Active trade cleared" });

}

module.exports = { placeOrder, doBacktest, ViewPrice, getEma, morecandleFetch, candlesFetch, getBotStatus, updBotStatus, StartBot, StopBot, SaveTrade, GetActiveTrades,ClearTrade }
