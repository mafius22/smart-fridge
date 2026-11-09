import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // /api przez Vite -> backend: ta sama domena, wiec ciasteczka sesji dzialaja tez przez jeden tunel (ngrok)
    proxy: {
      '/api': 'http://localhost:5000',
    },
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.loca.lt'],
  }
})
