import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5003',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', () => {}); // Suppress startup race condition errors
        },
      },
      '/uploads': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5003',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', () => {}); // Suppress startup race condition errors
        },
      },
    },
  },
})
