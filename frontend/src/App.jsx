import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { LayoutDashboard } from 'lucide-react';
import { format, subHours } from 'date-fns';
import './App.css';

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
  
  const [devices, setDevices] = useState([]);
  const [serverRules, setServerRules] = useState([]);
  
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [vapidKey, setVapidKey] = useState(null);
  
  const [dateRange, setDateRange] = useState({
    start: format(subHours(new Date(), 24), "yyyy-MM-dd'T'HH:mm"),
    end: format(new Date(), "yyyy-MM-dd'T'HH:mm")
  });
  const [visibility, setVisibility] = useState({ showTemp: true, showPress: true });
  
  const [userEndpoint, setUserEndpoint] = useState(null);
  const [isSubscribedBrowser, setIsSubscribedBrowser] = useState(false);
  
  const [settings, setSettings] = useState({ 
    isActive: true, 
    devices: [] 
  });

  const [status, setStatus] = useState({ type: 'info', msg: 'Łączenie...' });
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await apiClient.get('/status');
      if (res.data.devices) {
        const sorted = res.data.devices.sort((a, b) => a.device_id.localeCompare(b.device_id));
        setDevices(sorted);
      }
      if (res.data.vapid_public_key) setVapidKey(res.data.vapid_public_key);
    } catch (e) { console.error("Polling error", e); }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (devices.length > 0 && selectedDeviceId === null) {
      setSelectedDeviceId(devices[0].device_id);
    }
  }, [devices, selectedDeviceId]);


  useEffect(() => {
    if (devices.length === 0) return;

    const mergedDevices = devices.map(device => {
        const rule = serverRules.find(r => r.device_id === device.device_id);
        
        return {
            device_id: device.device_id,
            device_name: device.name || device.device_id,
            custom_threshold: rule ? rule.custom_threshold : '' 
        };
    });

    setSettings(prev => ({
        ...prev,
        devices: mergedDevices
    }));

  }, [devices, serverRules]); 


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
                
                setSettings(prev => ({ ...prev, isActive: res.data.is_active ?? true }));
                
                if (res.data.devices) {
                    setServerRules(res.data.devices);
                }

              } catch (err) { console.warn("Brak profilu w bazie lub błąd sieci", err); }
            }
        }
    };
    initSW();
  }, []);

  const saveSettings = async (devicesToSave) => {
    if (!userEndpoint) return alert("Brak endpointu subskrypcji.");
    
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
      
      setServerRules(devicesList.map(d => ({
          device_id: d.device_id,
          custom_threshold: d.custom_threshold
      })));
      
      setSettings(prev => ({ ...prev, devices: devicesList }));

      setStatus({ type: 'success', msg: 'Zapisano ustawienia!' });
      
    } catch (error) { 
      console.error("Save error:", error);
      setStatus({ type: 'error', msg: 'Błąd zapisu.' }); 
    }
  };

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
      
      setSettings(prev => ({ ...prev, isActive: true }));
      
    } catch (error) { alert(error.message); }
  };

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