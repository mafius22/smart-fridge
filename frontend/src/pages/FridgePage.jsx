import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import api, { apiError } from '../api/client';
import StateBadge from '../components/StateBadge';
import TemperatureChart from '../components/TemperatureChart';
import FridgeSettingsForm from '../components/FridgeSettingsForm';
import usePolling from '../utils/usePolling';
import { ALERT_LABELS, formatDateTime, formatDuration, formatTemp, timeAgo } from '../utils/format';

const RANGES = [
  { key: '24h', label: '24 h', seconds: 86400 },
  { key: '7d', label: '7 dni', seconds: 7 * 86400 },
  { key: '30d', label: '30 dni', seconds: 30 * 86400 },
];
const toLocalInput = (ts) => format(new Date(ts * 1000), "yyyy-MM-dd'T'HH:mm");
const fromLocalInput = (value) => Math.floor(new Date(value).getTime() / 1000);

export default function FridgePage() {
  const { id } = useParams();
  const [fridge, setFridge] = useState(null);
  const [folders, setFolders] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState('');

  const [rangeKey, setRangeKey] = useState('24h');
  const [custom, setCustom] = useState(() => {
    const now = Math.floor(Date.now() / 1000);
    return { start: toLocalInput(now - 86400), end: toLocalInput(now) };
  });
  const [history, setHistory] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadFridge = useCallback(async () => {
    try {
      const [f, a] = await Promise.all([api.get(`/fridges/${id}`), api.get(`/fridges/${id}/alerts`)]);
      setFridge(f.data.fridge);
      setAlerts(a.data.alerts);
      setError('');
    } catch (err) {
      setError(apiError(err, 'Nie udało się pobrać lodówki'));
    }
  }, [id]);

  usePolling(loadFridge, 30000, [id]);

  useEffect(() => {
    api.get('/folders').then((res) => setFolders(res.data.folders)).catch(() => {});
  }, []);

  const loadHistory = useCallback(async () => {
    let start;
    let end;
    if (rangeKey === 'custom') {
      start = fromLocalInput(custom.start);
      end = fromLocalInput(custom.end);
      if (!(start < end)) return setError('Początek zakresu musi być przed końcem');
    } else {
      end = Math.floor(Date.now() / 1000);
      start = end - RANGES.find((r) => r.key === rangeKey).seconds;
    }
    setLoadingHistory(true);
    try {
      const res = await api.get(`/fridges/${id}/measurements`, { params: { from: start, to: end } });
      setHistory(res.data);
    } catch (err) {
      setError(apiError(err, 'Nie udało się pobrać pomiarów'));
    } finally {
      setLoadingHistory(false);
    }
  }, [id, rangeKey, custom]);

  useEffect(() => {
    if (rangeKey !== 'custom') loadHistory();
    // Zakres wlasny laduje sie dopiero po kliknieciu "Pokaz"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rangeKey]);

  if (!fridge) return <div className="page-loading">{error || 'Ładowanie…'}</div>;

  const activeAlerts = fridge.alerts;
  const pastAlerts = alerts.filter((a) => a.ended_at);

  return (
    <div className="page">
      <Link to="/" className="back-link"><ArrowLeft size={16} /> Lodówki</Link>

      <div className="fridge-hero card">
        <div>
          <h1>{fridge.display_name}</h1>
          <div className="muted">
            {fridge.custom_name && <span>{fridge.name} · </span>}
            {fridge.location || 'bez lokalizacji'}
          </div>
        </div>
        <div className="hero-temp">
          <div className="fridge-temp big">{formatTemp(fridge.last_temp)}<span className="unit">°C</span></div>
          <div className="muted small">{timeAgo(fridge.last_ts)}</div>
        </div>
        <div className="hero-state">
          <StateBadge state={fridge.state} />
          {fridge.board && (
            <div className="muted small">
              płytka {fridge.board.online ? 'online' : `offline, ostatnio ${timeAgo(fridge.board.last_seen_at)}`}
            </div>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {activeAlerts.length > 0 && (
        <div className="card active-alerts">
          {activeAlerts.map((a) => (
            <div key={a.id} className={`alert ${a.is_fault ? 'alert-fault' : 'alert-error'}`}>
              <strong>{ALERT_LABELS[a.kind]}</strong>
              {a.value != null && ` (${a.value.toFixed(1)} °C)`} od {formatDateTime(a.started_at)}
            </div>
          ))}
        </div>
      )}

      <div className="layout-2">
        <section className="card">
          <div className="card-header">
            <h2>Temperatura</h2>
            <div className="range-buttons">
              {RANGES.map((r) => (
                <button key={r.key} className={`btn btn-sm ${rangeKey === r.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setRangeKey(r.key)}>
                  {r.label}
                </button>
              ))}
              <button className={`btn btn-sm ${rangeKey === 'custom' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setRangeKey('custom')}>
                Własny
              </button>
              <button className="btn btn-ghost btn-icon" onClick={loadHistory} title="Odśwież" disabled={loadingHistory}>
                <RefreshCw size={16} className={loadingHistory ? 'spin' : ''} />
              </button>
            </div>
          </div>

          {rangeKey === 'custom' && (
            <div className="inline-form">
              <input type="datetime-local" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} />
              <input type="datetime-local" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} />
              <button className="btn btn-secondary" onClick={loadHistory}>Pokaż</button>
            </div>
          )}

          {history ? (
            <>
              <TemperatureChart
                points={history.points}
                bucketS={history.bucket_s}
                start={history.start}
                end={history.end}
                minTemp={fridge.settings.min_temp}
                maxTemp={fridge.settings.max_temp}
              />
              <p className="muted small">
                {history.bucket_s > 0
                  ? `Średnia z ${history.bucket_s / 60} min, pasmo = min-max w przedziale.`
                  : 'Pojedyncze pomiary.'}
                {' '}Linie przerywane = Twoje progi.
              </p>
            </>
          ) : (
            <div className="chart-empty">Ładowanie…</div>
          )}
        </section>

        <aside className="card">
          <h2>Moje ustawienia</h2>
          <FridgeSettingsForm key={fridge.id} fridge={fridge} folders={folders} onSaved={(f) => setFridge(f)} />
        </aside>
      </div>

      <section className="card">
        <h2>Historia alarmów</h2>
        {pastAlerts.length === 0 ? (
          <p className="muted">Brak zakończonych alarmów.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Rodzaj</th><th>Początek</th><th>Czas trwania</th><th>Wartość</th></tr></thead>
            <tbody>
              {pastAlerts.map((a) => (
                <tr key={a.id}>
                  <td>{ALERT_LABELS[a.kind]}</td>
                  <td>{formatDateTime(a.started_at)}</td>
                  <td>{formatDuration(a.ended_at - a.started_at)}</td>
                  <td>{a.value != null ? `${a.value.toFixed(1)} °C` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
