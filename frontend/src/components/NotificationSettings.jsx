import React, { useState } from 'react';
import { Bell, Save, Settings, X } from 'lucide-react';

export default function NotificationSettings({ 
  isSubscribed, 
  settings, 
  setSettings, 
  onSubscribe, 
  onSave 
}) {
  // Stan do zarządzania widocznością okna ustawień
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* 1. Tylko przycisk zębatki widoczny na głównym ekranie */}
      <button 
        className="btn-settings-trigger" 
        onClick={() => setIsOpen(true)}
        title="Ustawienia powiadomień"
      >
        <Settings size={20} />
      </button>

      {/* 2. Modal (Okno wyskakujące) - widoczne tylko gdy isOpen === true */}
      {isOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            
            {/* Nagłówek Modala */}
            <div className="modal-header">
              <h2><Bell size={20} /> Ustawienia Powiadomień</h2>
              <button className="btn-close" onClick={() => setIsOpen(false)}>
                <X size={24} />
              </button>
            </div>

            {/* Treść Modala */}
            <div className="modal-body">
              {!isSubscribed ? (
                <div className="subscribe-prompt">
                  <p>Aby otrzymywać alerty, musisz włączyć powiadomienia.</p>
                  <button className="btn-primary" onClick={onSubscribe}>
                    Włącz Powiadomienia
                  </button>
                </div>
              ) : (
                <div className="settings-form">
                  <label className="checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={settings.isActive} 
                      onChange={(e) => setSettings({...settings, isActive: e.target.checked})}
                    />
                    Aktywne powiadomienia
                  </label>
                  
                  <div className="threshold-input">
                    <label>Próg temperatury (°C):</label>
                    <input 
                      type="number" 
                      step="0.5" 
                      value={settings.threshold || ''} 
                      onChange={(e) => setSettings({...settings, threshold: e.target.value})} 
                    />
                  </div>

                  <div className="modal-actions">
                    <button className="btn-save" onClick={() => { onSave(); setIsOpen(false); }}>
                      <Save size={18}/> Zapisz i zamknij
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