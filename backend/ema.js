async function fetchCandles() {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=SUIUSDT&interval=3m&limit=1000`;
        const { data } = await axios.get(url);

        const ohlcv = data.map(candle => ({
            time: candle[0],
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            closes: parseFloat(candle[4]),
            volume: parseFloat(candle[5])
        }));

        return { status: 1, ohlcv };
    } catch (err) {
        return {
            status: 0,
            msg: err.message || "Failed to fetch candle data"
        };
    }
}


async function calculateEmaSignal() {
    try {

        const { ohlcv, status } = await fetchCandles();
        if (status === 0 || !ohlcv || ohlcv.length < 60) {
            return { status: 0, msg: "Insufficient or invalid data" };
        }
        const data = ohlcv.map(c => c.closes);

        if (!Array.isArray(data) || data.length < 60) {
            console.error("❌ EMA error: Invalid or missing candle data");
            return { status: 0, msg: "Invalid or insufficient candle data" };
        }

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

        return {
            status: 1,
            msg: {
                ema9: last9,
                ema21: last21,
                ema50: last50,
                ema200: last200,
                signal
            }
        }
    }
    catch (err) {
        console.log({ status: 0, msg: err });

    }

}

module.exports = {fetchCandles,calculateEmaSignal}