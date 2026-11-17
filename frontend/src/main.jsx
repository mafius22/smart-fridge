import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './auth/AuthContext.jsx'
import { DialogsProvider } from './components/DialogsProvider.jsx'
import { Toaster } from './components/ui/sonner.jsx'
import { TooltipProvider } from './components/ui/tooltip.jsx'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((e) => console.error('Rejestracja service workera nie powiodła się', e))
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Motyw jasny/ciemny: klasa "dark" na <html>, domyslnie wg systemu */}
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        <BrowserRouter>
          <AuthProvider>
            <DialogsProvider>
              <App />
              <Toaster richColors position="top-center" />
            </DialogsProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
