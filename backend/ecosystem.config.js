// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "index",
      script: "./index.js",
      watch: false,
      autorestart: true,            // Always restart
      restart_delay: 1000,          // Wait 1s before restarting

      // Restart daily at 6am Pakistan time (which is 1am UTC)
      cron_restart: "1 1 * * *",

      // Optional: also restart if memory exceeds 300MB
      max_memory_restart: "300M",

      exp_backoff_restart_delay: 100, // Backoff delay
      stop_exit_codes: [],          // No exit code stops the app
      max_restarts: 0,              // No restart limit
      min_uptime: 0,                 // No minimum uptime requirement
    }
  ]
};
