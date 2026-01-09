import React, { useState, useEffect, useCallback, memo } from 'react';
import { Bell, Save, Settings, X, Thermometer, Cpu, AlertTriangle } from 'lucide-react';

// --- KOMPONENT WIERSZA (Zoptymalizowany) ---
const DeviceRow = memo(({ device, isActive, onThresholdChange }) => {
  
  const handleChange = (e) => {
    const val = e.target.value;
    const normalizedVal = val.replace(',', '.');
    if (normalizedVal === '' || normalizedVal === '-' || /^-?\d*(\.\d*)?$/.test(normalizedVal)) {
      onThresholdChange(device.device_id, normalizedVal);
    }
  };

  const toggleSign = () => {
    let current = device.custom_threshold ? String(device.custom_threshold) : '';
    if (current.startsWith('-')) {
      onThresholdChange(device.device_id, current.substring(1));
    } else {
      onThresholdChange(device.device_id, '-' + current);
    }
  };

  return (
    <div className="device-setting-row">
      <div className="device-info">
        <Cpu size={18} className="icon-device"/>
        <div className="device-names">
            <span className="device-name-main">{device.device_name}</span>
        </div>
      </div>
      
      <div className="threshold-input-wrapper">
        <button className="btn-sign-toggle" onClick={toggleSign} disabled={!isActive}>+/-</button>
        <input 
          type="text" 
          inputMode="decimal"
          disabled={!isActive}
          value={device.custom_threshold} 
          onChange={handleChange} 
          placeholder="Brak"
        />
        <span className="unit">°C</span>
      </div>
    </div>
  );
});

// --- GŁÓWNY KOMPONENT ---
export default function NotificationSettings({ 
  isSubscribed, 
  settings, 
  setSettings, // To używamy tylko do globalnego switcha
  onSubscribe, 
  onSave 
}) {
  const [isOpen, setIsOpen] = useState(false);
  
  // TO JEST KLUCZOWE: Lokalna kopia urządzeń do edycji ("Brudnopis")
  const [localDevices, setLocalDevices] = useState([]);

  // Kiedy otwieramy modal, kopiujemy aktualne dane z App.js do brudnopisu.
  // Dzięki [isOpen] robimy to TYLKO RAZ przy otwarciu, więc App.js nie nadpisze nam edycji w trakcie pisania.
  useEffect(() => {
    if (isOpen && settings?.devices) {
      // Robimy głęboką kopię, żeby oderwać się od referencji App.js
      setLocalDevices(JSON.parse(JSON.stringify(settings.devices)));
    }
  }, [isOpen]); // Zależymy tylko od otwarcia okna, a nie od zmiany settings w tle!

  // Edytujemy tylko lokalny "brudnopis"
  const handleLocalChange = useCallback((deviceId, newValue) => {
    setLocalDevices(prev => prev.map(dev => {
        if (dev.device_id === deviceId) {
            return { ...dev, custom_threshold: newValue };
        }
        return dev;
    }));
  }, []);

  const handleGlobalToggle = (e) => {
      // Globalny switch możemy zmieniać od razu w App.js, bo to jedno kliknięcie
      setSettings(prev => ({ ...prev, isActive: e.target.checked }));
  };

  const handleSaveClick = () => {
      // Przekazujemy nasz "brudnopis" do funkcji zapisu w App.js
      onSave(localDevices);
      setIsOpen(false);
  };

  return (
    <>
      <button className="btn-settings-trigger" onClick={() => setIsOpen(true)}>
        <Settings size={20} />
      </button>

      {isOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2><Bell size={20} /> Konfiguracja Alertów</h2>
              <button className="btn-close" onClick={() => setIsOpen(false)}><X size={24} /></button>
            </div>

            <div className="modal-body">
              {!isSubscribed ? (
                <div className="subscribe-prompt">
                  <div className="icon-wrapper"><AlertTriangle size={32} /></div>
                  <p>Brak aktywnych powiadomień.</p>
                  <button className="btn-primary" onClick={onSubscribe}>Włącz Powiadomienia</button>
                </div>
              ) : (
                <div className="settings-form">
                  <div className="global-setting">
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings?.isActive || false} onChange={handleGlobalToggle} />
                      <span className="label-text">Wysyłaj powiadomienia</span>
                    </label>
                  </div>
                  <hr className="divider" />
                  
                  <div className="devices-settings-list">
                    <h3>Progi temperatur</h3>
                    {localDevices && localDevices.length > 0 ? (
                      localDevices.map((device) => (
                        <DeviceRow 
                          key={device.device_id}
                          device={device}
                          isActive={settings.isActive}
                          onThresholdChange={handleLocalChange}
                        />
                      ))
                    ) : (
                      <p className="no-devices">Brak urządzeń.</p>
                    )}
                  </div>
                  
                  <div className="modal-actions">
                    <button className="btn-save" onClick={handleSaveClick}>
                      <Save size={18}/> Zapisz
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}