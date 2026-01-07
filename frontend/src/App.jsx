import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Bell, BellOff, Save, RefreshCw, Thermometer, Gauge, Activity, Calendar, Search } from 'lucide-react';
import { format, subHours, parseISO } from 'date-fns';
import './App.css';

// --- KONFIGURACJA API (FIX DLA NGROK) ---
const API_URL = import.meta.env.VITE_API_URL;

// Tworzymy instancję axios, żeby automatycznie dodawać nagłówki
// To naprawia problem z ostrzeżeniem Ngroka
const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true' // <--- TO NAPRAWIA BŁĄD POBIERANIA DANYCH
  }
});

// Helper: Konwersja klucza VAPID
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

function App() {
  // --- STANY DANYCH ---
  // Inicjalizujemy zerami, żeby UI nie skakało
  const [currentData, setCurrentData] = useState({ temp: 0, press: 0, time: null });
  const [historyData, setHistoryData] = useState([]);
  const [vapidKey, setVapidKey] = useState(null);
  
  // --- STANY UI I FILTRÓW ---
  const [dateRange, setDateRange] = useState({
    start: format(subHours(new Date(), 24), "yyyy-MM-dd'T'HH:mm"),
    end: format(new Date(), "yyyy-MM-dd'T'HH:mm")
  });
  
  const [visibility, setVisibility] = useState({
    showTemp: true,
    showPress: true
  });

  // --- STANY UŻYTKOWNIKA ---
  const [userEndpoint, setUserEndpoint] = useState(null);
  // Ustawiamy domyślne wartości, żeby inputy były "Controlled"
  const [settings, setSettings] = useState({ isActive: true, threshold: 8.0 });
  const [isSubscribedBrowser, setIsSubscribedBrowser] = useState(false);
  const [status, setStatus] = useState({ type: 'info', msg: 'Inicjalizacja...' });
  const [loadingHistory, setLoadingHistory] = useState(false);

  // 1. Inicjalizacja
  useEffect(() => {
    const init = async () => {
      try {
        const statusRes = await apiClient.get('/status');
        
        if (statusRes.data.vapid_public_key) setVapidKey(statusRes.data.vapid_public_key);
        if (statusRes.data.data) setCurrentData(statusRes.data.data);

        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          
          if (sub) {
            setUserEndpoint(sub.endpoint);
            setIsSubscribedBrowser(true);
            try {
              const settingsRes = await apiClient.get('/subscribe', { params: { endpoint: sub.endpoint } });
              setSettings({ 
                isActive: settingsRes.data.is_active ?? true, 
                threshold: settingsRes.data.custom_threshold ?? 8.0 
              });
              setStatus({ type: 'success', msg: 'Załadowano profil' });
            } catch (err) { console.warn("Brak profilu w bazie dla tej subskrypcji", err); }
          }
        }
      } catch (error) { 
        console.error("Init Error:", error);
        setStatus({ type: 'error', msg: 'Błąd połączenia z serwerem' }); 
      }
    };
    init();
  }, []);

  // 2. Polling (Status na żywo)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await apiClient.get('/status');
        if (res.data.data) setCurrentData(res.data.data);
      } catch (e) { 
        // Cichy błąd przy poolingu, żeby nie spamować
        console.error("Polling error", e); 
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // 3. Pobieranie historii (POPRAWIONE ZABEZPIECZENIA)
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      const startStr = format(startDate, 'yyyy-MM-dd HH:mm:ss');
      const endStr = format(endDate, 'yyyy-MM-dd HH:mm:ss');

      console.log(`Pobieranie historii: ${startStr} -> ${endStr}`);

      const res = await apiClient.get('/measurements', {
        params: { start: startStr, end: endStr }
      });
      
      // ZABEZPIECZENIE: Sprawdzamy czy data istnieje i jest tablicą
      const rawData = res.data.data;
      if (!Array.isArray(rawData)) {
        console.warn("Otrzymano nieprawidłowe dane historii:", rawData);
        setHistoryData([]); 
        return;
      }

      const formatted = rawData.map(item => {
        try {
          const dateObj = new Date(item.time);
          return {
            time: format(dateObj, 'HH:mm'),
            fullDate: item.time,
            temp: item.temp,
            press: item.press ? (item.press / 100).toFixed(0) : 0
          };
        } catch (e) { return null; }
      }).filter(Boolean);
      
      setHistoryData(formatted);
      setStatus({ type: 'success', msg: `Pobrano ${formatted.length} pomiarów` });

    } catch (error) {
      console.error("Błąd historii:", error);
      setStatus({ type: 'error', msg: 'Błąd pobierania historii' });
      setHistoryData([]); // Czyścimy wykres w razie błędu
    } finally {
      setLoadingHistory(false);
    }
  }, [dateRange]);

  // Pobierz historię przy pierwszym uruchomieniu
  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const handleDateChange = (e) => {
    setDateRange({ ...dateRange, [e.target.name]: e.target.value });
  };

  // --- POZOSTAŁE FUNKCJE ---
  const handleSubscribe = async () => {
    if (!vapidKey) return alert("Błąd: Serwer nie zwrócił klucza VAPID. Odśwież stronę.");
    try {
      setStatus({ type: 'info', msg: 'Rejestrowanie...' });
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ 
        userVisibleOnly: true, 
        applicationServerKey: urlBase64ToUint8Array(vapidKey) 
      });
      
      await apiClient.post('/subscribe', { endpoint: sub.endpoint, keys: sub.toJSON().keys });
      
      setUserEndpoint(sub.endpoint);
      setIsSubscribedBrowser(true);
      setStatus({ type: 'success', msg: 'Powiadomienia włączone!' });
    } catch (error) { 
      console.error(error);
      setStatus({ type: 'error', msg: 'Błąd subskrypcji.' }); 
    }
  };

  const saveSettings = async () => {
    if (!userEndpoint) return alert("Brak aktywnej subskrypcji.");
    try {
      setStatus({ type: 'info', msg: 'Zapisywanie...' });
      await apiClient.put('/subscribe', { 
        endpoint: userEndpoint, 
        is_active: settings.isActive, 
        custom_threshold: parseFloat(settings.threshold) 
      });
      setStatus({ type: 'success', msg: 'Ustawienia zapisane!' });
    } catch (error) { 
      setStatus({ type: 'error', msg: 'Błąd zapisu ustawień.' }); 
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo">
          <Activity size={28} />
          <h1>Smart Fridge Monitor</h1>
        </div>
        <div className={`status-badge ${status.type}`}>{status.msg}</div>
      </header>

      <main className="dashboard-grid">
        
        {/* LEWA KOLUMNA: Current Stats */}
        <section className="stats-section">
          <div className={`stat-card ${currentData.temp > settings.threshold ? 'warning' : ''}`}>
            <div className="icon-wrapper temp"><Thermometer /></div>
            <div className="stat-content">
              <h3>Temperatura</h3>
              <div className="value">{currentData.temp !== null ? Number(currentData.temp).toFixed(1) : '--'} °C</div>
              <span className="subtitle">Limit: {settings.threshold}°C</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="icon-wrapper press"><Gauge /></div>
            <div className="stat-content">
              <h3>Ciśnienie</h3>
              <div className="value">{currentData.press ? (currentData.press / 100).toFixed(0) : '--'} hPa</div>
            </div>
          </div>
        </section>

        {/* PRAWA KOLUMNA: Wykres */}
        <section className="chart-section">
          <div className="chart-controls">
            <div className="date-inputs">
              <div className="input-group">
                <label>Od:</label>
                <input 
                  type="datetime-local" 
                  name="start" 
                  value={dateRange.start} 
                  onChange={handleDateChange} 
                />
              </div>
              <div className="input-group">
                <label>Do:</label>
                <input 
                  type="datetime-local" 
                  name="end" 
                  value={dateRange.end} 
                  onChange={handleDateChange} 
                />
              </div>
              <button onClick={fetchHistory} disabled={loadingHistory} className="btn-search">
                {loadingHistory ? <RefreshCw className="spin" size={18}/> : <Search size={18}/>}
              </button>
            </div>

            <div className="toggles">
              <label className={`toggle-btn ${visibility.showTemp ? 'active-temp' : ''}`}>
                <input 
                  type="checkbox" 
                  checked={visibility.showTemp}
                  onChange={(e) => setVisibility({...visibility, showTemp: e.target.checked})}
                />
                Temp
              </label>
              <label className={`toggle-btn ${visibility.showPress ? 'active-press' : ''}`}>
                <input 
                  type="checkbox" 
                  checked={visibility.showPress}
                  onChange={(e) => setVisibility({...visibility, showPress: e.target.checked})}
                />
                Ciśnienie
              </label>
            </div>
          </div>

          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height="100%">
              {/* Dodano sprawdzenie czy są dane, żeby wykres nie rzucał błędami */}
              {historyData && historyData.length > 0 ? (
                <LineChart data={historyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="time" tick={{fontSize: 12}} />
                  
                  <YAxis 
                    yAxisId="left" 
                    domain={['auto', 'auto']} 
                    hide={!visibility.showTemp}
                  />
                  <YAxis 
                    yAxisId="right" 
                    orientation="right" 
                    domain={['auto', 'auto']} 
                    hide={!visibility.showPress} 
                  />
                  
                  <Tooltip 
                    labelFormatter={(label, payload) => {
                      if (payload && payload.length > 0) return `Czas: ${payload[0].payload.fullDate}`;
                      return label;
                    }}
                  />
                  <Legend />

                  {visibility.showTemp && (
                    <Line 
                      yAxisId="left" 
                      type="monotone" 
                      dataKey="temp" 
                      stroke="#ef4444" 
                      strokeWidth={2} 
                      dot={false} 
                      name="Temp (°C)"
                      animationDuration={500}
                    />
                  )}

                  {visibility.showPress && (
                    <Line 
                      yAxisId="right" 
                      type="monotone" 
                      dataKey="press" 
                      stroke="#3b82f6" 
                      strokeWidth={2} 
                      dot={false} 
                      name="Ciśnienie (hPa)"
                      animationDuration={500}
                    />
                  )}
                </LineChart>
              ) : (
                <div className="no-data-msg">Brak danych dla wybranego okresu lub błąd połączenia.</div>
              )}
            </ResponsiveContainer>
          </div>
        </section>

        {/* DOLNY PANEL: Ustawienia */}
        <section className="settings-section">
          <h2><Bell size={20} /> Ustawienia Powiadomień</h2>
          {!isSubscribedBrowser ? (
            <button className="btn-primary" onClick={handleSubscribe}>Włącz Powiadomienia</button>
          ) : (
            <div className="settings-form">
              <label className="checkbox-label">
                <input type="checkbox" checked={settings.isActive} onChange={(e) => setSettings({...settings, isActive: e.target.checked})}/>
                Aktywne
              </label>
              <div className="threshold-input">
                <label>Próg (°C):</label>
                {/* Zabezpieczenie wartości inputa */}
                <input 
                    type="number" 
                    step="0.5" 
                    value={settings.threshold || ''} 
                    onChange={(e) => setSettings({...settings, threshold: e.target.value})}
                />
              </div>
              <button className="btn-save" onClick={saveSettings}><Save size={18}/> Zapisz</button>
            </div>
          )}
        </section>

      </main>
      <footer className="footer">System v2.1</footer>
    </div>
  );
}

export default App;