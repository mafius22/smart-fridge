import { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL;

function App() {
  const [data, setData] = useState({ temp: 0, press: 0, time: '' });
  const [vapidKey, setVapidKey] = useState(null);
  
  // NOWE: Stan dla identyfikacji użytkownika i jego ustawień
  const [userEndpoint, setUserEndpoint] = useState(null);
  const [settings, setSettings] = useState({
    isActive: true,
    threshold: 8.0
  });

  const [status, setStatus] = useState("Ładowanie...");

  // 1. Sprawdzanie czy użytkownik już jest zapisany (przy starcie)
  useEffect(() => {
    const checkSubscription = async () => {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          setUserEndpoint(sub.endpoint);
          console.log("Wykryto istniejącą subskrypcję");
        }
      }
    };
    checkSubscription();
  }, []);

  // 2. Pobieranie danych pomiarowych
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(`${API_URL}/status`);
        if (response.data.data) setData(response.data.data);
        if (response.data.vapid_public_key) setVapidKey(response.data.vapid_public_key);
        setStatus("Połączono ✅");
      } catch (error) {
        console.error("Błąd API:", error);
        setStatus("Błąd połączenia ❌");
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, []);

  // Helper Base64
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // 3. Rejestracja (POST)
  const subscribeToPush = async () => {
    if (!vapidKey) return alert("Błąd: Brak klucza VAPID.");
    if (!('serviceWorker' in navigator)) return alert("Brak wsparcia dla SW.");

    try {
      setStatus("Rejestrowanie...");
      const register = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      
      const subscription = await register.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });

      // Wysyłamy do backendu
      await axios.post(`${API_URL}/subscribe`, subscription);
      
      // Zapisujemy endpoint w stanie, żeby odblokować panel ustawień
      setUserEndpoint(subscription.endpoint);
      
      setStatus("Powiadomienia aktywne! 🔔");
      alert("Zapisano na powiadomienia!");

    } catch (error) {
      console.error("Błąd subskrypcji:", error);
      setStatus("Błąd zapisu na powiadomienia");
    }
  };

  // NOWE: 4. Aktualizacja ustawień (PUT)
  const updateSettings = async () => {
    if (!userEndpoint) return;

    try {
      setStatus("Aktualizowanie ustawień...");
      
      const response = await axios.put(`${API_URL}/subscribe`, {
        endpoint: userEndpoint, // To identyfikuje użytkownika
        is_active: settings.isActive,
        custom_threshold: parseFloat(settings.threshold)
      });

      setStatus("Ustawienia zapisane ✅");
      alert(`Sukces! ${response.data.message}`);

    } catch (error) {
      console.error("Błąd aktualizacji:", error);
      setStatus("Błąd zapisu ustawień ❌");
      alert("Nie udało się zapisać ustawień.");
    }
  };

  return (
    <div className="container">
      <h1>🌡️ Smart Fridge Monitor</h1>
      
      <div className={`status-bar ${status.includes("Błąd") ? "error" : ""}`}>
        Status: {status}
      </div>

      <div className="card-grid">
        {/* Karta Temperatury */}
        <div className={`card temp-card ${data.temp > settings.threshold ? 'alarm' : ''}`}>
          <h2>Temperatura</h2>
          <div className="value">{data.temp?.toFixed(1)} °C</div>
          <small>Limit: {settings.threshold} °C</small>
        </div>
        
        {/* Karta Ciśnienia */}
        <div className="card">
          <h2>Ciśnienie</h2>
          <div className="value">{data.press?.toFixed(0)} hPa</div>
        </div>
      </div>

      <p className="last-update">Ostatni pomiar: {data.time || '--:--:--'}</p>

      {/* Przycisk subskrypcji - znika, jeśli użytkownik już subskrybuje */}
      {!userEndpoint ? (
        <button 
          className="subscribe-btn" 
          onClick={subscribeToPush} 
          disabled={!vapidKey}
        >
          Włącz Alarmy Push 🔔
        </button>
      ) : (
        /* NOWE: Panel Ustawień - pojawia się tylko dla subskrybentów */
        <div className="settings-panel">
          <h3>⚙️ Ustawienia Alarmów</h3>
          
          <div className="form-group">
            <label>
              <input 
                type="checkbox" 
                checked={settings.isActive}
                onChange={(e) => setSettings({...settings, isActive: e.target.checked})}
              />
              Wysyłaj powiadomienia
            </label>
          </div>

          <div className="form-group">
            <label>Próg alarmowy (°C):</label>
            <input 
              type="number" 
              step="0.5"
              value={settings.threshold}
              onChange={(e) => setSettings({...settings, threshold: e.target.value})}
            />
          </div>

          <button className="save-btn" onClick={updateSettings}>
            Zapisz zmiany 💾
          </button>
        </div>
      )}
    </div>
  )
}

export default App