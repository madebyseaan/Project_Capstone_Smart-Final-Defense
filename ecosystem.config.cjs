module.exports = {
  apps: [
    {
      name: 'server',
      cwd: './server',
      script: 'node',
      args: 'node_modules/ts-node-dev/lib/bin.js --respawn --transpile-only src/index.ts',
      wait_ready: true,
      listen_timeout: 15000,
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'client',
      cwd: '.',
      script: 'node',
      args: 'scripts/wait-for-server.cjs',
      autorestart: true,
      watch: false,
    },
  ],
};
