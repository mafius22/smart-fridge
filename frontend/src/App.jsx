import { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'

// Adres Twojego Backendu
const API_URL = import.meta.env.VITE_API_URL;

function App() {
  const [data, setData] = useState({ temp: 0, press: 0, time: '' });
  const [vapidKey, setVapidKey] = useState(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [status, setStatus] = useState("Ładowanie...");

  // 1. Pobieranie danych z backendu (Status + Klucz VAPID)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(`${API_URL}/status`);
        
        // Aktualizacja danych pomiarowych
        if (response.data.data) {
          setData(response.data.data);
        }
        
        // Pobranie klucza publicznego (potrzebny do subskrypcji)
        if (response.data.vapid_public_key) {
          setVapidKey(response.data.vapid_public_key);
        }

        setStatus("Połączono ✅");
      } catch (error) {
        console.error("Błąd API:", error);
        setStatus("Błąd połączenia z serwerem ❌");
      }
    };

    fetchData(); // Pierwsze pobranie natychmiast
    const interval = setInterval(fetchData, 2000); // Odświeżanie co 2 sekundy

    return () => clearInterval(interval);
  }, []);

  // 2. Funkcja pomocnicza: Konwersja klucza Base64 na format zrozumiały dla przeglądarki
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // 3. Logika zapisu na powiadomienia
  const subscribeToPush = async () => {
    if (!vapidKey) {
      alert("Błąd: Nie pobrano klucza VAPID z serwera.");
      return;
    }

    if (!('serviceWorker' in navigator)) {
      alert("Twoja przeglądarka nie obsługuje Service Workerów.");
      return;
    }

    try {
      setStatus("Rejestrowanie Service Workera...");
      
      // A. Rejestracja pliku sw.js
      const register = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      setStatus("Czekam na zgodę użytkownika...");

      // B. Pytanie przeglądarki o zgodę i subskrypcja
      const subscription = await register.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });

      console.log("Wygenerowano subskrypcję:", subscription);

      // C. Wysłanie subskrypcji do Backendu
      await axios.post(`${API_URL}/subscribe`, subscription);
      
      setIsSubscribed(true);
      setStatus("Powiadomienia aktywne! 🔔");
      alert("Sukces! Będziesz otrzymywać powiadomienia.");

    } catch (error) {
      console.error("Błąd subskrypcji:", error);
      setStatus("Błąd subskrypcji (sprawdź konsolę)");
      alert("Coś poszło nie tak. Sprawdź konsolę (F12).");
    }
  };

  return (
    <div className="container">
      <h1>🌡️ Smart Fridge Monitor</h1>
      
      <div className={`status-bar ${status.includes("Błąd") ? "error" : ""}`}>
        Status: {status}
      </div>

      <div className="card-grid">
        <div className={`card temp-card ${data.temp > 30 ? 'alarm' : ''}`}>
          <h2>Temperatura</h2>
          <div className="value">{data.temp?.toFixed(1)} °C</div>
        </div>
        
        <div className="card">
          <h2>Ciśnienie</h2>
          <div className="value">{data.press?.toFixed(0)} hPa</div>
        </div>
      </div>

      <p className="last-update">Ostatni pomiar: {data.time || '--:--:--'}</p>

      <button 
        className="subscribe-btn" 
        onClick={subscribeToPush} 
        disabled={isSubscribed || !vapidKey}
      >
        {isSubscribed ? 'Powiadomienia włączone ✅' : 'Włącz Alarmy Push 🔔'}
      </button>

      {!vapidKey && <p className="warning">Brak klucza VAPID - sprawdź Backend!</p>}
    </div>
  )
}

export default App