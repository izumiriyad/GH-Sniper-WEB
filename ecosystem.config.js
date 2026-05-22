module.exports = {
  apps: [{
    name: 'ghsniper',
    script: 'dist/server.js',
    node_args: '--expose-gc --max-old-space-size=1024 --nouse-idle-notification --max-semi-space-size=128',
    instances: 1, // 🔥 ALMIGHTY: Single instance required for better-sqlite3 (native addon cannot share DB across cluster workers)
    autorestart: true,
    watch: false,
    max_memory_restart: '900M',
    env: {
      UV_THREADPOOL_SIZE: 128, // 🔥 ALMIGHTY: Maximize concurrent DNS/crypto threads
      NODE_ENV: 'production',
      PORT: 3000,
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 3000,
    max_restarts: 100,
    exp_backoff_restart_delay: 1000, // Exponential backoff on crash loops
    kill_timeout: 8000, // Give graceful shutdown handler time to flush WAL
    listen_timeout: 10000,
    cron_restart: '0 4 * * *', // Force restart at 4 AM daily to flush memory
  }]
};
