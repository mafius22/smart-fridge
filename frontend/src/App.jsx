import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { LayoutDashboard } from 'lucide-react';
import { format, subHours } from 'date-fns';
import './App.css';

// Komponenty
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

// Pomocnicza funkcja do klucza VAPID
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function App() {
  // --- STATE ---
  
  // 1. Dane podstawowe
  const [devices, setDevices] = useState([]); // Lista urządzeń online (z /status)
  const [serverRules, setServerRules] = useState([]); // <--- KLUCZOWE: Surowe reguły pobrane z bazy (z /subscribe)
  
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [vapidKey, setVapidKey] = useState(null);
  
  // 2. Filtry i Wykresy
  const [dateRange, setDateRange] = useState({
    start: format(subHours(new Date(), 24), "yyyy-MM-dd'T'HH:mm"),
    end: format(new Date(), "yyyy-MM-dd'T'HH:mm")
  });
  const [visibility, setVisibility] = useState({ showTemp: true, showPress: true });
  
  // 3. Subskrypcja i Użytkownik
  const [userEndpoint, setUserEndpoint] = useState(null);
  const [isSubscribedBrowser, setIsSubscribedBrowser] = useState(false);
  
  // 4. Ustawienia (Scalone: urządzenia + reguły)
  const [settings, setSettings] = useState({ 
    isActive: true, 
    devices: [] 
  });

  const [status, setStatus] = useState({ type: 'info', msg: 'Łączenie...' });
  const [loadingHistory, setLoadingHistory] = useState(false);

  // --- LOGIKA 1: POBIERANIE STATUSU (URZĄDZENIA) ---
  const fetchStatus = async () => {
    try {
      const res = await apiClient.get('/status');
      if (res.data.devices) {
        // Sortujemy alfabetycznie po ID, żeby nie skakały na liście
        const sorted = res.data.devices.sort((a, b) => a.device_id.localeCompare(b.device_id));
        setDevices(sorted);
      }
      if (res.data.vapid_public_key) setVapidKey(res.data.vapid_public_key);
    } catch (e) { console.error("Polling error", e); }
  };

  // Uruchomienie pętli pobierania statusu co 5 sekund
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Automatyczne wybranie pierwszego urządzenia po załadowaniu
  useEffect(() => {
    if (devices.length > 0 && selectedDeviceId === null) {
      setSelectedDeviceId(devices[0].device_id);
    }
  }, [devices, selectedDeviceId]);


  // --- LOGIKA 2: SCALANIE DANYCH (MÓZG APLIKACJI) ---
  // Ten useEffect uruchamia się, gdy przyjdą nowe urządzenia z ESP LUB nowe reguły z Bazy
  useEffect(() => {
    if (devices.length === 0) return;

    const mergedDevices = devices.map(device => {
        // Szukamy, czy w danych z bazy (serverRules) jest wpis dla tego urządzenia
        const rule = serverRules.find(r => r.device_id === device.device_id);
        
        return {
            device_id: device.device_id,
            device_name: device.name || device.device_id,
            // Jeśli znaleziono regułę w bazie, użyj jej wartości. Jeśli nie - pusty string.
            // Używamy 'custom_threshold' zgodnie z Twoim kodem Python.
            custom_threshold: rule ? rule.custom_threshold : '' 
        };
    });

    setSettings(prev => ({
        ...prev,
        devices: mergedDevices
    }));

  }, [devices, serverRules]); // Zależy od obu źródeł danych


  // --- LOGIKA 3: INICJALIZACJA SERVICE WORKER I POBRANIE PROFILU ---
  useEffect(() => {
    const initSW = async () => {
        if ('serviceWorker' in navigator) {
            try { await navigator.serviceWorker.register('/sw.js'); } catch (e) { console.error(e); }
            
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            
            if (sub) {
              setUserEndpoint(sub.endpoint);
              setIsSubscribedBrowser(true);
              
              // Pobieramy ustawienia z backendu
              try {
                const res = await apiClient.get('/subscribe', { params: { endpoint: sub.endpoint } });
                
                // A. Ustawiamy flagę globalną (Włącz/Wyłącz)
                setSettings(prev => ({ ...prev, isActive: res.data.is_active ?? true }));
                
                // B. Zapisujemy SUROWE reguły do osobnego stanu
                // Python zwraca: { is_active: ..., devices: [ {device_id, custom_threshold}, ... ] }
                if (res.data.devices) {
                    setServerRules(res.data.devices);
                }

              } catch (err) { console.warn("Brak profilu w bazie lub błąd sieci", err); }
            }
        }
    };
    initSW();
  }, []);

  // --- LOGIKA 4: ZAPISYWANIE USTAWIEŃ ---
// --- 4. ZAPISYWANIE USTAWIEŃ (ZAKTUALIZOWANE) ---
  // Teraz funkcja przyjmuje opcjonalny argument 'devicesToSave'
  const saveSettings = async (devicesToSave) => {
    if (!userEndpoint) return alert("Brak endpointu subskrypcji.");
    
    // Jeśli nie przekazano konkretnych urządzeń, weź te ze stanu (zabezpieczenie)
    const devicesList = devicesToSave || settings.devices;

    setStatus({ type: 'info', msg: 'Zapisywanie...' });

    try {
      const promises = [];
      
      if (devicesList && devicesList.length > 0) {
        devicesList.forEach(device => {
            const payload = {
                endpoint: userEndpoint,
                device_id: device.device_id,
                is_active: settings.isActive, 
                custom_threshold: (device.custom_threshold === '' || device.custom_threshold === null) 
                    ? null 
                    : parseFloat(device.custom_threshold)
            };
            promises.push(apiClient.put('/subscribe', payload));
        });
      }

      await Promise.all(promises);
      
      // Aktualizujemy lokalny stan w App.js, żeby UI od razu pokazał nowe wartości
      setServerRules(devicesList.map(d => ({
          device_id: d.device_id,
          custom_threshold: d.custom_threshold
      })));
      
      // Aktualizujemy też główny settings, żeby nie mrugnęło starą wartością
      setSettings(prev => ({ ...prev, devices: devicesList }));

      setStatus({ type: 'success', msg: 'Zapisano ustawienia!' });
      
    } catch (error) { 
      console.error("Save error:", error);
      setStatus({ type: 'error', msg: 'Błąd zapisu.' }); 
    }
  };

  // --- LOGIKA 5: SUBSKRYPCJA (Browser) ---
  const handleSubscribe = async () => {
    if (!vapidKey) return alert("Brak klucza VAPID.");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error("Brak zgody na powiadomienia.");
      
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ 
        userVisibleOnly: true, 
        applicationServerKey: urlBase64ToUint8Array(vapidKey) 
      });
      
      await apiClient.post('/subscribe', { endpoint: sub.endpoint, keys: sub.toJSON().keys });
      setUserEndpoint(sub.endpoint);
      setIsSubscribedBrowser(true);
      setStatus({ type: 'success', msg: 'Zarejestrowano!' });
      
      // Po rejestracji ustawiamy domyślny stan
      setSettings(prev => ({ ...prev, isActive: true }));
      
    } catch (error) { alert(error.message); }
  };

  // --- LOGIKA 6: HISTORIA I WYKRESY ---
  const fetchHistory = useCallback(async () => {
    if (!selectedDeviceId) return;
    setLoadingHistory(true);
    try {
      const startStr = format(new Date(dateRange.start), "yyyy-MM-dd'T'HH:mm:ss");
      const endStr = format(new Date(dateRange.end), "yyyy-MM-dd'T'HH:mm:ss");
      
      const res = await apiClient.get('/measurements', { 
        params: { start: startStr, end: endStr, device_id: selectedDeviceId } 
      });
      
      const rawData = res.data.data || [];
      const formatted = rawData.map(item => ({
        time: item.time ? format(new Date(item.time), 'HH:mm') : '--:--',
        fullDate: item.time,
        temp: item.temp,
        press: item.press ? Number(item.press).toFixed(0) : 0
      }));
      
      setHistoryData(formatted);
      setStatus({ type: 'success', msg: `Dane odświeżone` });
    } catch (error) {
      console.error(error);
      setHistoryData([]); 
    } finally {
      setLoadingHistory(false);
    }
  }, [dateRange, selectedDeviceId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // --- RENDER (Widok) ---
  return (
    <div className="app-container">
      <header className="header">
        <div className="logo">
          <LayoutDashboard size={28} />
          <h1>Smart Fridge</h1>
        </div>
        
        <div className={`status-badge ${status.type}`}>{status.msg}</div>
        
        <NotificationSettings 
          isSubscribed={isSubscribedBrowser}
          settings={settings}
          setSettings={setSettings}
          onSubscribe={handleSubscribe}
          onSave={saveSettings}
        />
      </header>

      <main className="dashboard-grid">
        <DeviceList 
          devices={devices} 
          selectedId={selectedDeviceId}
          onSelect={setSelectedDeviceId}
          threshold={settings.devices.find(d => d.device_id === selectedDeviceId)?.custom_threshold}
        />

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

      <footer className="footer">IoT System v2.2</footer>
    </div>
  );
}

export default App;