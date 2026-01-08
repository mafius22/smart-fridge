import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Search, RefreshCw } from 'lucide-react';

export default function HistoryChart({ 
  data, 
  dateRange, 
  onDateChange, 
  onSearch, 
  isLoading, 
  visibility, 
  setVisibility 
}) {
  return (
    <section className="chart-section">
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

      <div className="chart-wrapper">
        <ResponsiveContainer width="100%" height="100%">
          {data && data.length > 0 ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="time" tick={{fontSize: 12}} />
              <YAxis yAxisId="left" domain={['auto', 'auto']} hide={!visibility.showTemp} />
              <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} hide={!visibility.showPress} />
              <Tooltip labelFormatter={(label, payload) => payload && payload.length > 0 ? `Czas: ${payload[0].payload.fullDate}` : label} />
              <Legend />
              {visibility.showTemp && (
                <Line yAxisId="left" type="monotone" dataKey="temp" stroke="#ef4444" strokeWidth={2} dot={false} name="Temp (°C)" animationDuration={500} />
              )}
              {visibility.showPress && (
                <Line yAxisId="right" type="monotone" dataKey="press" stroke="#3b82f6" strokeWidth={2} dot={false} name="Ciśnienie (hPa)" animationDuration={500} />
              )}
            </LineChart>
          ) : (
            <div className="no-data-msg">Brak danych dla wybranego okresu lub błąd połączenia.</div>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}