import React from 'react';
import { Bell, Save } from 'lucide-react';

export default function NotificationSettings({ 
  isSubscribed, 
  settings, 
  setSettings, 
  onSubscribe, 
  onSave 
}) {
  return (
    <section className="settings-section">
      <h2><Bell size={20} /> Ustawienia Powiadomień</h2>
      
      {!isSubscribed ? (
        <button className="btn-primary" onClick={onSubscribe}>
          Włącz Powiadomienia
        </button>
      ) : (
        <div className="settings-form">
          <label className="checkbox-label">
            <input 
              type="checkbox" 
              checked={settings.isActive} 
              onChange={(e) => setSettings({...settings, isActive: e.target.checked})}
            />
            Aktywne
          </label>
          <div className="threshold-input">
            <label>Próg (°C):</label>
            <input 
              type="number" 
              step="0.5" 
              value={settings.threshold || ''} 
              onChange={(e) => setSettings({...settings, threshold: e.target.value})} 
            />
          </div>
          <button className="btn-save" onClick={onSave}>
            <Save size={18}/> Zapisz
          </button>
        </div>
      )}
    </section>
  );
}