import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { LayoutDashboard } from 'lucide-react';
import { format, subHours } from 'date-fns';
import './App.css';

// Zmieniliśmy nazwę CurrentStats na DeviceList, bo teraz to lista
import DeviceList from './components/DeviceList'; 
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
  const [devices, setDevices] = useState([]); // Lista urządzeń
  const [selectedDeviceId, setSelectedDeviceId] = useState(null); // Aktualnie wybrany do wykresu

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
  const [status, setStatus] = useState({ type: 'info', msg: 'Łączenie...' });
  const [loadingHistory, setLoadingHistory] = useState(false);

  // --- 1. POBIERANIE STANU (URZĄDZENIA) ---
const fetchStatus = async () => {
    try {
      const res = await apiClient.get('/status');
      if (res.data.devices) {
        setDevices(res.data.devices);
        // TU JUŻ NIE USTAWIAMY selectedDeviceId
      }
      if (res.data.vapid_public_key) setVapidKey(res.data.vapid_public_key);
    } catch (e) { console.error("Polling error", e); }
  };

  // Pętla odświeżania (bez zmian)
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // --- NOWY: INTELIGENTNY AUTO-WYBÓR ---
  useEffect(() => {
    // Jeśli lista urządzeń przyszła, a my nic nie mamy zaznaczonego -> zaznacz pierwsze
    if (devices.length > 0 && selectedDeviceId === null) {
      setSelectedDeviceId(devices[0].device_id);
    }
  }, [devices, selectedDeviceId]);

  useEffect(() => {
    fetchStatus();
    // Odświeżaj status co 5 sekund
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []); // Wywołaj tylko raz przy montowaniu (plus interwał)

  // --- 2. INICJALIZACJA SUBSKRYPCJI (Service Worker) ---
  useEffect(() => {
    const initSW = async () => {
        if ('serviceWorker' in navigator) {
            try { await navigator.serviceWorker.register('/sw.js'); } catch (e) { console.error(e); }
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
                setStatus({ type: 'success', msg: 'System gotowy' });
              } catch (err) { console.warn("Brak profilu", err); }
            }
        }
    };
    initSW();
  }, []);

  // --- 3. HISTORIA (ZALEŻNA OD WYBRANEGO DEVICE_ID) ---
const fetchHistory = useCallback(async () => {
    if (!selectedDeviceId) return;

    setLoadingHistory(true);
    try {
      // Formatowanie daty do zapytania (to zostaje po staremu)
      const startStr = format(new Date(dateRange.start), "yyyy-MM-dd'T'HH:mm:ss");
      const endStr = format(new Date(dateRange.end), "yyyy-MM-dd'T'HH:mm:ss");
      
      const res = await apiClient.get('/measurements', { 
        params: { 
            start: startStr, 
            end: endStr,
            device_id: selectedDeviceId 
        } 
      });
      
      const rawData = res.data.data || [];
      
      // --- TUTAJ JEST KLUCZOWA ZMIANA ---
      const formatted = rawData.map(item => ({
        // Backend: "time" -> Frontend bierze: item.time
        time: item.time ? format(new Date(item.time), 'HH:mm') : '--:--',
        fullDate: item.time,

        // Backend: "temp" -> Frontend bierze: item.temp
        temp: item.temp,

        // Backend: "press" -> Frontend bierze: item.press
        // UWAGA: Jeśli w bazie masz hPa (np. 1013), zostaw tak jak poniżej.
        // Jeśli masz Pascale (np. 101300), dopisz dzielenie: (item.press / 100)
        press: item.press ? Number(item.press).toFixed(0) : 0
      }));
      
      setHistoryData(formatted);
      setStatus({ type: 'success', msg: `Pobrano dane: ${formatted.length} pkt` });

    } catch (error) {
      console.error(error);
      setStatus({ type: 'error', msg: 'Błąd historii' });
      setHistoryData([]); 
    } finally {
      setLoadingHistory(false);
    }
  }, [dateRange, selectedDeviceId]);

  // Pobierz historię, gdy zmieni się data lub wybrane urządzenie
  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // --- LOGIKA SUBSKRYPCJI (BEZ ZMIAN) ---
  const handleSubscribe = async () => {
    if (!vapidKey) return alert("Błąd: Brak klucza VAPID.");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error("Brak zgody.");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ 
        userVisibleOnly: true, 
        applicationServerKey: urlBase64ToUint8Array(vapidKey) 
      });
      await apiClient.post('/subscribe', { endpoint: sub.endpoint, keys: sub.toJSON().keys });
      setUserEndpoint(sub.endpoint);
      setIsSubscribedBrowser(true);
      setStatus({ type: 'success', msg: 'Powiadomienia włączone!' });
    } catch (error) { alert(error.message); }
  };

  const saveSettings = async () => {
    if (!userEndpoint) return alert("Brak subskrypcji.");
    try {
      await apiClient.put('/subscribe', { 
        endpoint: userEndpoint, 
        is_active: settings.isActive, 
        custom_threshold: parseFloat(settings.threshold) 
      });
      setStatus({ type: 'success', msg: 'Zapisano ustawienia!' });
    } catch (error) { setStatus({ type: 'error', msg: 'Błąd zapisu.' }); }
  };

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo">
          <LayoutDashboard size={28} />
          <h1>Smart Fridge Manager</h1>
        </div>
        
        <div className={`status-badge ${status.type}`}>{status.msg}</div>
        
        {/* Ustawienia */}
        <NotificationSettings 
          isSubscribed={isSubscribedBrowser}
          settings={settings}
          setSettings={setSettings}
          onSubscribe={handleSubscribe}
          onSave={saveSettings}
        />
      </header>

      <main className="dashboard-grid">
        {/* Lista Urządzeń (zamiast CurrentStats) */}
        <DeviceList 
          devices={devices} 
          selectedId={selectedDeviceId}
          onSelect={setSelectedDeviceId}
          threshold={settings.threshold}
        />

        {/* Wykres */}
        <HistoryChart 
          data={historyData}
          dateRange={dateRange}
          onDateChange={(e) => setDateRange({ ...dateRange, [e.target.name]: e.target.value })}
          onSearch={fetchHistory}
          isLoading={loadingHistory}
          visibility={visibility}
          setVisibility={setVisibility}
          selectedDeviceName={devices.find(d => d.device_id === selectedDeviceId)?.name || selectedDeviceId}
        />

      </main>

      <footer className="footer">System IoT</footer>
    </div>
  );
}

export default App;