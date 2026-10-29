// ==============================================================================
// LifeLink India — PM2 Production Process Manager Configuration
// ==============================================================================
// Use this configuration to manage LifeLink directly on Ubuntu/Debian/RHEL/Windows
// without Docker.
// Start: pm2 start ecosystem.config.js --env production
// Logs:  pm2 logs lifelink-backend
// ==============================================================================

module.exports = {
  apps: [
    {
      name: 'lifelink-backend',
      script: 'dist/server.js',
      instances: 'max', // Multi-core cluster mode
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5000,
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 10000, // 10s graceful shutdown window
      listen_timeout: 15000,
    },
  ],
};
