import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // /api przez Vite -> backend: ta sama domena, wiec ciasteczka sesji dzialaja tez przez jeden tunel (ngrok)
    proxy: {
      '/api': 'http://localhost:5000',
    },
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.loca.lt'],
  }
})
