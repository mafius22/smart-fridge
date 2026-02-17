import React from 'react';
import { Thermometer, Gauge, MapPin, Server, Activity } from 'lucide-react';

export default function DeviceList({ devices, selectedId, onSelect, threshold }) {
  
  if (!devices || devices.length === 0) {
    return (
      <div className="stats-section empty">
        <div className="stat-card info">
          <div className="icon-wrapper gray"><Server /></div>
          <div className="stat-content">
            <h3>Brak urządzeń</h3>
            <span className="subtitle">Czekam na dane z backendu...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="stats-section device-list">
      {devices.map((dev) => {
        const reading = dev.last_reading || {};
        const temp = reading.temp; 
        const press = reading.pressure || reading.press;
        
        const isSelected = dev.device_id === selectedId;

        const isWarning = isSelected && 
                          threshold !== null && 
                          threshold !== '' && 
                          temp !== undefined && 
                          parseFloat(temp) > parseFloat(threshold);

        return (
          <div 
            key={dev.device_id}
            className={`stat-card device-card ${isSelected ? 'selected' : ''}`}
            onClick={() => onSelect(dev.device_id)}
          >
            <div className={`icon-wrapper ${isWarning ? 'temp' : 'default'}`}>
               {isWarning ? <Activity /> : <Thermometer />}
            </div>
            
            <div className="stat-content">
              <h3>{dev.name || dev.device_id}</h3>
              
              <div className="value">
                {temp !== undefined && temp !== null 
                  ? `${Number(temp).toFixed(1)} °C` 
                  : <span className="no-data">--.- °C</span>
                }
              </div>

              <div className="meta-row">
                 <span className="subtitle location">
                    <MapPin size={12}/> {dev.location || 'Brak lok.'}
                 </span>
                 
                 {press && Number(press) > 0 && (
                     <span className="subtitle press-tag">
                        <Gauge size={12} style={{marginRight: 4}}/>
                        {(Number(press) / 100).toFixed(0)} hPa
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