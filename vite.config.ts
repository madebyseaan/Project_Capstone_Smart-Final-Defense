import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5003',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', () => {}); // Suppress startup race condition errors
        },
      },
      '/uploads': {
        target: 'http://localhost:5003',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', () => {}); // Suppress startup race condition errors
        },
      },
    },
  },
})
