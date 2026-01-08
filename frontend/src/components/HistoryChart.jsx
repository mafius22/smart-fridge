import React, { useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Search, RefreshCw, BarChart2 } from 'lucide-react';

export default function HistoryChart({ 
  data, 
  dateRange, 
  onDateChange, 
  onSearch, 
  isLoading, 
  visibility, 
  setVisibility,
  selectedDeviceName 
}) {


  return (
    <section className="chart-section">
      <div className="chart-header">
         <h2>
            <BarChart2 size={20} /> 
            Historia: <span className="highlight">{selectedDeviceName || 'Wybierz urządzenie'}</span>
         </h2>
      </div>

      <div className="chart-controls">
        <div className="date-inputs">
          <div className="input-group">
            <label>Od:</label>
            <input 
              type="datetime-local" 
              name="start" 
              value={dateRange.start} 
              onChange={onDateChange} 
            />
          </div>
          <div className="input-group">
            <label>Do:</label>
            <input 
              type="datetime-local" 
              name="end" 
              value={dateRange.end} 
              onChange={onDateChange} 
            />
          </div>
          <button onClick={onSearch} disabled={isLoading} className="btn-search">
            {isLoading ? <RefreshCw className="spin" size={18}/> : <Search size={18}/>}
          </button>
        </div>

        <div className="toggles">
          <label className={`toggle-btn ${visibility.showTemp ? 'active-temp' : ''}`}>
            <input 
              type="checkbox" 
              checked={visibility.showTemp} 
              onChange={(e) => setVisibility({...visibility, showTemp: e.target.checked})} 
            />
            Temp
          </label>
          <label className={`toggle-btn ${visibility.showPress ? 'active-press' : ''}`}>
            <input 
              type="checkbox" 
              checked={visibility.showPress} 
              onChange={(e) => setVisibility({...visibility, showPress: e.target.checked})} 
            />
            Ciśnienie
          </label>
        </div>
      </div>

      {/* WYMUSZONA WYSOKOŚĆ DLA TESTU */}
      <div style={{ width: '100%', height: 400, minHeight: 400 }}>
        <ResponsiveContainer width="100%" height="100%">
          {data && data.length > 0 ? (
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              
              <XAxis 
                dataKey="time" 
                minTickGap={30}
              />
              
              <YAxis 
                yAxisId="left" 
                hide={!visibility.showTemp}
                domain={['auto', 'auto']} 
              />
              <YAxis 
                yAxisId="right" 
                orientation="right" 
                hide={!visibility.showPress}
                domain={['auto', 'auto']} 
              />
              
              <Tooltip 
                 labelFormatter={(val) => `Godzina: ${val}`}
              />
              <Legend />
              
              {visibility.showTemp && (
                <Line 
                    yAxisId="left" 
                    type="monotone" 
                    dataKey="temp" 
                    stroke="#ef4444" 
                    strokeWidth={2} 
                    dot={false} 
                    name="Temperatura" 
                    isAnimationActive={false} // Wyłącz animację dla testu
                />
              )}
              {visibility.showPress && (
                <Line 
                    yAxisId="right" 
                    type="monotone" 
                    dataKey="press" 
                    stroke="#3b82f6" 
                    strokeWidth={2} 
                    dot={false} 
                    name="Ciśnienie" 
                    isAnimationActive={false}
                />
              )}
            </LineChart>
          ) : (
            <div className="no-data-msg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                {selectedDeviceName 
                    ? `Brak danych dla ${selectedDeviceName} (Sprawdź konsolę F12)` 
                    : "Wybierz urządzenie z listy po lewej."}
            </div>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}