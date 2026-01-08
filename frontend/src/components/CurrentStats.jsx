import React from 'react';
import { Thermometer, Gauge } from 'lucide-react';

export default function CurrentStats({ data, threshold }) {
  const { temp, press } = data;
  const isWarning = temp > threshold;

  return (
    <section className="stats-section">
      <div className={`stat-card ${isWarning ? 'warning' : ''}`}>
        <div className="icon-wrapper temp"><Thermometer /></div>
        <div className="stat-content">
          <h3>Temperatura</h3>
          <div className="value">
            {temp !== null ? Number(temp).toFixed(1) : '--'} °C
          </div>
          <span className="subtitle">Limit: {threshold}°C</span>
        </div>
      </div>
      
      <div className="stat-card">
        <div className="icon-wrapper press"><Gauge /></div>
        <div className="stat-content">
          <h3>Ciśnienie</h3>
          <div className="value">
            {press ? (press / 100).toFixed(0) : '--'} hPa
          </div>
        </div>
      </div>
    </section>
  );
}