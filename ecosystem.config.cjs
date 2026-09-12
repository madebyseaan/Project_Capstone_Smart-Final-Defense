module.exports = {
  apps: [
    {
      name: 'server',
      cwd: './server',
      script: './node_modules/ts-node-dev/lib/bin.js',
      args: '--respawn --transpile-only src/index.ts',
      wait_ready: true,
      listen_timeout: 15000,
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        NODE_ENV: 'production',
        // DEMO ONLY — set to 'true' to let SMART manage term dates locally
        // (for presentations when EnrollPro's term config doesn't cover today).
        // Leave 'false' for normal operation.
        DEMO_TERM_MODE: 'false',
      },
    },
    {
      name: 'client',
      cwd: '.',
      script: './scripts/wait-for-server.cjs',
      autorestart: true,
      watch: false,
    },
  ],
};
