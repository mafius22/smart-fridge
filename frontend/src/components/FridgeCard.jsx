import { useNavigate } from 'react-router-dom';
import { Thermometer, AlertTriangle, WifiOff } from 'lucide-react';
import StateBadge from './StateBadge';
import { ALERT_LABELS, formatTemp, thresholdsLabel, timeAgo } from '../utils/format';

export default function FridgeCard({ fridge, folders, onMove }) {
  const navigate = useNavigate();
  const Icon = fridge.state === 'offline' ? WifiOff : (fridge.state === 'ok' || fridge.state === 'no_data' ? Thermometer : AlertTriangle);

  return (
    <div
      className={`card fridge-card state-${fridge.state}`}
      onClick={() => navigate(`/fridges/${fridge.id}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/fridges/${fridge.id}`); }}
    >
      <div className="fridge-card-head">
        <div className="fridge-icon"><Icon size={18} /></div>
        <div className="fridge-title">
          <h3>{fridge.display_name}</h3>
          {fridge.location && <span className="muted small">{fridge.location}</span>}
        </div>
        <StateBadge state={fridge.state} />
      </div>

      <div className="fridge-temp">
        {formatTemp(fridge.last_temp)}<span className="unit">°C</span>
      </div>

      <div className="fridge-meta">
        <span>{timeAgo(fridge.last_ts)}</span>
        <span>{thresholdsLabel(fridge.settings)}</span>
      </div>

      {fridge.alerts.length > 0 && (
        <ul className="alert-chips">
          {fridge.alerts.map((a) => <li key={a.id} className={a.is_fault ? 'chip chip-fault' : 'chip chip-alarm'}>{ALERT_LABELS[a.kind]}</li>)}
        </ul>
      )}

      {onMove && (
        <select
          className="folder-select"
          value={fridge.folder_id ?? ''}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => onMove(fridge, e.target.value === '' ? null : Number(e.target.value))}
          aria-label="Folder"
        >
          <option value="">Bez folderu</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}
    </div>
  );
}
