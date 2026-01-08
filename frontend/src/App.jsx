import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Activity } from 'lucide-react';
import { format, subHours } from 'date-fns';
import './App.css';

// Importujemy nowe komponenty
import CurrentStats from './components/CurrentStats';
import HistoryChart from './components/HistoryChart';
import NotificationSettings from './components/NotificationSettings';

const API_URL = import.meta.env.VITE_API_URL;
const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true'
  }
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function App() {
  // --- STATE ---
  const [currentData, setCurrentData] = useState({ temp: 0, press: 0, time: null });
  const [historyData, setHistoryData] = useState([]);
  const [vapidKey, setVapidKey] = useState(null);
  const [dateRange, setDateRange] = useState({
    start: format(subHours(new Date(), 24), "yyyy-MM-dd'T'HH:mm"),
    end: format(new Date(), "yyyy-MM-dd'T'HH:mm")
  });
  const [visibility, setVisibility] = useState({ showTemp: true, showPress: true });
  const [userEndpoint, setUserEndpoint] = useState(null);
  const [settings, setSettings] = useState({ isActive: true, threshold: 8.0 });
  const [isSubscribedBrowser, setIsSubscribedBrowser] = useState(false);
  const [status, setStatus] = useState({ type: 'info', msg: 'Inicjalizacja...' });
  const [loadingHistory, setLoadingHistory] = useState(false);

  // --- LOGIC: INIT & POLLING ---
  useEffect(() => {
    const init = async () => {
      try {
        if ('serviceWorker' in navigator) {
            try { await navigator.serviceWorker.register('/sw.js'); } 
            catch (e) { console.error('SW Error:', e); }

            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            
            if (sub) {
              setUserEndpoint(sub.endpoint);
              setIsSubscribedBrowser(true);
              try {
                const res = await apiClient.get('/subscribe', { params: { endpoint: sub.endpoint } });
                setSettings({ 
                  isActive: res.data.is_active ?? true, 
                  threshold: res.data.custom_threshold ?? 8.0 
                });
                setStatus({ type: 'success', msg: 'Załadowano profil' });
              } catch (err) { console.warn("Brak profilu", err); }
            }
        }
        
        const statusRes = await apiClient.get('/status');
        if (statusRes.data.vapid_public_key) setVapidKey(statusRes.data.vapid_public_key);
        if (statusRes.data.data) setCurrentData(statusRes.data.data);
      } catch (error) { 
        setStatus({ type: 'error', msg: 'Błąd serwera' }); 
      }
    };
    init();
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await apiClient.get('/status');
        if (res.data.data) setCurrentData(res.data.data);
      } catch (e) { console.error("Polling error", e); }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // --- LOGIC: HISTORY ---
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const startStr = format(new Date(dateRange.start), 'yyyy-MM-dd HH:mm:ss');
      const endStr = format(new Date(dateRange.end), 'yyyy-MM-dd HH:mm:ss');
      const res = await apiClient.get('/measurements', { params: { start: startStr, end: endStr } });
      
      const rawData = res.data.data || [];
      const formatted = rawData.map(item => ({
        time: format(new Date(item.time), 'HH:mm'),
        fullDate: item.time,
        temp: item.temp,
        press: item.press ? (item.press / 100).toFixed(0) : 0
      }));
      
      setHistoryData(formatted);
      setStatus({ type: 'success', msg: `Pobrano ${formatted.length} pomiarów` });
    } catch (error) {
      setStatus({ type: 'error', msg: 'Błąd historii' });
      setHistoryData([]); 
    } finally {
      setLoadingHistory(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // --- LOGIC: SUBSCRIPTION ---
  const handleSubscribe = async () => {
    if (!vapidKey) return alert("Błąd: Brak klucza VAPID.");
    try {
      setStatus({ type: 'info', msg: 'Potwierdź uprawnienia...' });
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error("Brak zgody na powiadomienia.");

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
      alert("BŁĄD: " + error.message);
      setStatus({ type: 'error', msg: 'Błąd subskrypcji.' }); 
    }
  };

  const saveSettings = async () => {
    if (!userEndpoint) return alert("Brak subskrypcji.");
    try {
      await apiClient.put('/subscribe', { 
        endpoint: userEndpoint, 
        is_active: settings.isActive, 
        custom_threshold: parseFloat(settings.threshold) 
      });
      setStatus({ type: 'success', msg: 'Zapisano!' });
    } catch (error) { setStatus({ type: 'error', msg: 'Błąd zapisu.' }); }
  };

  // --- RENDER ---
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
        {/* Lewa kolumna */}
        <CurrentStats 
          data={currentData} 
          threshold={settings.threshold} 
        />

        {/* Prawa kolumna */}
        <HistoryChart 
          data={historyData}
          dateRange={dateRange}
          onDateChange={(e) => setDateRange({ ...dateRange, [e.target.name]: e.target.value })}
          onSearch={fetchHistory}
          isLoading={loadingHistory}
          visibility={visibility}
          setVisibility={setVisibility}
        />

        {/* Dolny panel */}
        <NotificationSettings 
          isSubscribed={isSubscribedBrowser}
          settings={settings}
          setSettings={setSettings}
          onSubscribe={handleSubscribe}
          onSave={saveSettings}
        />
      </main>

      <footer className="footer">System v2.2 Refactored</footer>
    </div>
  );
}

export default App;