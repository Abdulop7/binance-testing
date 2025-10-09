const cors = require('cors');
const express = require("express");
require("dotenv").config()
let app = express()
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }));
const port =  5000; // ✅ right
const mongoose = require("mongoose");
const BotRouter = require('./app/routes/botRoutes.js');
const { getBotStatusFromDB, updateBotStatus, startLoop, updLastSignal, initTradeCount, calculateEmaSignal, setTpSl, setLastTradeSignal } = require('./botrunner.js');
const { startPriceSocket, startCandleSocket, prefillCandles } = require('./binanceWebSocket.js');



app.use((req, res, next) => {
  // Skip authentication for /bot/status
  if (req.path === "/bot/status") {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(" ")[1];

  if (!token || token !== process.env.ACCESS_TOKEN) {
    // console.log(`⛔ Unauthorized access attempt to ${req.path}`);
    return res.status(403).send('Access denied');
  }

  next();
});



app.use("/bot", BotRouter)


mongoose.connect(process.env.DbUrl).then(() => {
  console.log("Database Connected to :", process.env.DbUrl);

  app.listen(port, "0.0.0.0",() => {
    console.log("Server is Running on:", port);

    prefillCandles("SOLUSDT", "3m", 1000);
    startPriceSocket("solusdt");
    startCandleSocket("solusdt");
    // Delay initialization logic by 3 seconds
    setTimeout(async () => {
      try {
        const { isActive, inTrade } = await getBotStatusFromDB();
        console.log(`Bot isActive:${isActive}`);

        if (isActive) {
          console.log("Bot Activating...");

          let res = await calculateEmaSignal()
          const newSignal = res.msg.signal;
          console.log("✅ Last Signal Registered: ", newSignal);
          updLastSignal(newSignal);

          await updateBotStatus(true, newSignal, inTrade);

          initTradeCount();
          setTpSl();


          try{

            // Get the active trade data from the backend
            const tradeRes = await axios.get(`${process.env.backendURL}/bot/get-trade`,
              {
                headers: {
                  Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
                }
              }); // WebUrl here 
              
              
              if (tradeRes){

              const {type} = tradeRes.data;
              
              setLastTradeSignal(type);

              console.log(`Last Trade Signal Set to : ${type}`);
              
            } 
          }catch(e){
            console.log(`⚠️ No Active Trade Found`);
            
          }
            

          const now = new Date();
          const minutes = now.getMinutes();
          const seconds = now.getSeconds();

          const remainder = 3 - (minutes % 3);
          const delay = (remainder * 60 - seconds + 1) * 1000;

          console.log(`⏳ Waiting ${delay / 1000}s until next 3-min candle...`);

          setTimeout(() => {
            console.log("⏰ Delay over — executing start");
            try {
              startLoop(); // should log "✅ startLoop triggered"
            } catch (err) {
              console.error("❌ Failed to start bot inside timeout:", err.message);
            }
          }, delay);
        } else {
          console.log("🟡 Bot is inactive. Not restarting.");
        }
      } catch (err) {
        console.error("❌ Error during bot startup:", err.message);
      }
    }, 1000 * 30); // 30-second delay
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🧨 Unhandled Rejection:', reason);
  process.exit(1); // PM2 will restart
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  process.exit(1); // PM2 will restart
});
