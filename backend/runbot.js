// runBot.js (in root or backend folder)
const botrunner = require('./botrunner');

(async () => {
  try {
    console.log("🚀 Starting bot via PM2...");
    await botrunner.startBot();
  } catch (err) {
    console.error("❌ Failed to start bot:", err);
  }
})();
