import React from 'react';
import { Thermometer, Gauge, MapPin, Server } from 'lucide-react';

export default function DeviceList({ devices, selectedId, onSelect, threshold }) {
  
  if (!devices || devices.length === 0) {
    return (
      <div className="stats-section empty">
        <div className="stat-card info">
          <div className="icon-wrapper press"><Server /></div>
          <div className="stat-content">
            <h3>Brak urządzeń</h3>
            <span className="subtitle">Oczekiwanie na dane MQTT...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="stats-section device-list">
      {devices.map((dev) => {
        const data = dev.last_reading || {};
        const temp = data.temp; // lub data.temp zależnie od JSON z backendu
        const press = data.pressure;   // lub data.press
        
        const isWarning = temp !== undefined && temp > threshold;
        const isSelected = dev.device_id === selectedId;

        return (
          <div 
            key={dev.device_id}
            className={`stat-card device-card ${isWarning ? 'warning' : ''} ${isSelected ? 'selected' : ''}`}
            onClick={() => onSelect(dev.device_id)}
          >
            <div className={`icon-wrapper ${isWarning ? 'temp' : 'press'}`}>
               {isWarning ? <Thermometer /> : <Server />}
            </div>
            
            <div className="stat-content">
              <h3>{dev.name}</h3>
              
              <div className="value">
                {temp !== undefined ? Number(temp).toFixed(1) + ' °C' : '--'}
              </div>

              <div className="meta-row">
                 <span className="subtitle location">
                    <MapPin size={12}/> {dev.location || 'Nieznana'}
                 </span>
                 {press && press > 0 && (
                     <span className="subtitle press-tag">
                        {(press / 100).toFixed(0)} hPa
                     </span>
                 )}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}