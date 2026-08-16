module.exports = {
  apps: [
    {
      name: 'server',
      cwd: './server',
      script: 'npx',
      args: 'ts-node-dev --respawn --transpile-only src/index.ts',
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'client',
      script: 'npx',
      args: 'vite --host',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
