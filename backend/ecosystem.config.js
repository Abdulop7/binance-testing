module.exports = {
  apps: [{
    name: "index",
    script: "./index.js",
    watch: false,
    autorestart: true,
    restart_delay: 1000,
    max_restarts: 10,
    exp_backoff_restart_delay: 100,
    stop_exit_codes: [1] // Will stop only if exit code is 1
  }]
}
