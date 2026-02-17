import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Search, RefreshCw, BarChart2 } from 'lucide-react';

export default function HistoryChart({ 
  data, 
  dateRange, 
  onDateChange, 
  onSearch, 
  isLoading, 
  selectedDeviceName 
}) {

  const hasData = data && data.length > 0;

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
        
      </div>

      <div style={{ width: '100%', height: 400, minHeight: 400, position: 'relative'}}>
        
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              
              <XAxis 
                dataKey="time" 
                minTickGap={30}
              />
              
              <YAxis 
                    domain={['auto', 'auto']} 
                    unit="°C" 
                    tickFormatter={(value) => value.toFixed(1)} 
                />
              
              <Tooltip 
                 labelFormatter={(val) => `Godzina: ${val}`}
                 formatter={(value) => [`${value}°C`, 'Temperatura']}
              />
              <Legend />
              
              <Line 
                  type="monotone" 
                  dataKey="temp" 
                  stroke="#ef4444" 
                  strokeWidth={3} 
                  dot={false} 
                  name="Temperatura" 
                  isAnimationActive={false} 
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ 
            width: '100%', 
            height: '100%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            backgroundColor: '#f9fafb',
            borderRadius: '8px',
            border: '1px dashed #e5e7eb',
            color: '#6b7280'
          }}>
              <p style={{ margin: 0, fontWeight: 500 }}>
                {selectedDeviceName 
                    ? `Brak danych dla ${selectedDeviceName}` 
                    : "Wybierz urządzenie z listy po lewej."}
              </p>
          </div>
        )}
      </div>
    </section>
  );
}