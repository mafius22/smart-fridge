import { useCallback, useState } from 'react';
import { Download, Pencil, RotateCcw } from 'lucide-react';
import api, { apiError } from '../../api/client';
import usePolling from '../../utils/usePolling';
import { formatDateTime, formatTemp, timeAgo } from '../../utils/format';

const OTA_LABELS = {
  none: 'brak', pending: 'w toku', ok: 'OK', error: 'błąd', rollback: 'wycofano (rollback)',
};

export default function BoardsPage() {
  const [boards, setBoards] = useState(null);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/admin/boards');
      setBoards(res.data.boards);
    } catch (err) {
      setMessage({ type: 'error', text: apiError(err) });
    }
  }, []);

  usePolling(load, 30000);

  const act = async (fn) => {
    try {
      const res = await fn();
      setMessage({ type: 'success', text: res?.data?.message || 'Zapisano' });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: apiError(err) });
    }
  };

  const rename = (b) => {
    const name = window.prompt('Nazwa płytki (puste = brak)', b.name || '');
    if (name !== null) act(() => api.patch(`/admin/boards/${b.id}`, { name: name.trim() || null }));
  };

  const reset = (b) => {
    if (window.confirm(`Zrestartować ${b.name || b.id}? Restart nastąpi po najbliższym cyklu pomiarowym (do 5 min).`)) {
      act(() => api.post(`/admin/boards/${b.id}/reset`));
    }
  };

  const update = (b) => {
    const url = window.prompt(`Adres firmware (.bin, https://) dla ${b.name || b.id}. Obecna wersja: ${b.fw || '?'}`);
    if (url) act(() => api.post(`/admin/boards/${b.id}/update`, { url: url.trim() }));
  };

  if (boards === null) return <div className="page-loading">{message?.text || 'Ładowanie…'}</div>;

  return (
    <div className="page">
      <h1>Płytki</h1>
      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}
      {boards.length === 0 && <div className="card empty">Brak płytek. Płytka pojawi się tu sama po pierwszej wiadomości MQTT.</div>}

      <div className="board-grid">
        {boards.map((b) => (
          <section key={b.id} className="card board-card">
            <div className="card-header">
              <div>
                <h2>{b.name || b.id}</h2>
                {b.name && <div className="mono muted small">{b.id}</div>}
              </div>
              <span className={`badge ${b.online ? 'badge-ok' : 'badge-offline'}`}>{b.online ? 'online' : 'offline'}</span>
            </div>

            <dl className="kv">
              <dt>Ostatnio widziana</dt><dd>{timeAgo(b.last_seen_at)}</dd>
              <dt>Firmware</dt><dd>{b.fw || '-'}</dd>
              <dt>Ostatnie OTA</dt><dd className={b.ota === 'error' || b.ota === 'rollback' ? 'text-danger' : ''}>{OTA_LABELS[b.ota] || '-'}</dd>
              <dt>Wi-Fi (RSSI)</dt><dd>{b.rssi != null ? `${b.rssi} dBm` : '-'}</dd>
              <dt>Bufor offline</dt><dd>{b.buffered != null ? `${b.buffered} pomiarów` : '-'}</dd>
              <dt>Interwał</dt><dd>{b.interval_s ? `${b.interval_s / 60} min` : '-'}</dd>
              <dt>Ostatni status</dt><dd>{formatDateTime(b.last_status_at)}</dd>
            </dl>

            <h3>Czujniki</h3>
            {b.sensors.length === 0 ? <p className="muted small">Brak</p> : (
              <ul className="sensor-list">
                {b.sensors.map((s) => (
                  <li key={s.id} className={s.present ? '' : 'text-danger'}>
                    <span className="mono small">{s.id}</span>
                    <span>{formatTemp(s.last_temp)} °C</span>
                    <span className="muted small">{s.fridge ? s.fridge.name : 'nieprzypisany'}{!s.present && ' · brak w statusie'}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="row-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => rename(b)}><Pencil size={14} /> Nazwa</button>
              <button className="btn btn-secondary btn-sm" onClick={() => reset(b)}><RotateCcw size={14} /> Restart</button>
              <button className="btn btn-secondary btn-sm" onClick={() => update(b)}><Download size={14} /> Aktualizuj firmware</button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
