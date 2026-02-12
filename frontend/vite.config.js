import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      'wet-donuts-tell.loca.lt'// konkretny host
    ],
    // LUB jeśli chcesz mieć spokój przy zmianach adresu ngrok:
    // allowedHosts: 'all' 
  }
})