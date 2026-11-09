import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Link2Off, Pencil, Plus, Trash2 } from 'lucide-react';
import api, { apiError } from '../../api/client';
import StateBadge from '../../components/StateBadge';
import usePolling from '../../utils/usePolling';
import { formatTemp, timeAgo } from '../../utils/format';

export default function FridgesAdminPage() {
  const [fridges, setFridges] = useState([]);
  const [sensors, setSensors] = useState([]);
  const [form, setForm] = useState({ name: '', location: '' });
  const [choice, setChoice] = useState({});
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      const [f, s] = await Promise.all([api.get('/admin/fridges'), api.get('/admin/sensors', { params: { unassigned: 1 } })]);
      setFridges(f.data.fridges);
      setSensors(s.data.sensors);
    } catch (err) {
      setMessage({ type: 'error', text: apiError(err) });
    }
  }, []);

  usePolling(load, 30000);

  const act = async (fn, okText) => {
    try {
      await fn();
      setMessage(okText ? { type: 'success', text: okText } : null);
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: apiError(err) });
    }
  };

  const create = (e) => {
    e.preventDefault();
    act(async () => {
      await api.post('/admin/fridges', { name: form.name, location: form.location.trim() || null });
      setForm({ name: '', location: '' });
    }, 'Dodano lodówkę');
  };

  const edit = (f) => {
    const name = window.prompt('Nazwa lodówki', f.name);
    if (!name || !name.trim()) return;
    const location = window.prompt('Lokalizacja (puste = brak)', f.location || '');
    if (location === null) return;
    act(() => api.patch(`/admin/fridges/${f.id}`, { name: name.trim(), location: location.trim() || null }));
  };

  const assign = (f) => {
    const sensorId = choice[f.id];
    if (!sensorId) return;
    act(() => api.post(`/admin/fridges/${f.id}/assign`, { sensor_id: sensorId }), 'Przypisano czujnik - nowe pomiary trafiają do tej lodówki');
  };

  return (
    <div className="page">
      <h1>Lodówki i czujniki</h1>
      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

      <section className="card">
        <h2>Nowa lodówka</h2>
        <form className="inline-form" onSubmit={create}>
          <input placeholder="Nazwa, np. Chłodnia nabiał" value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input placeholder="Lokalizacja (opcjonalnie)" value={form.location} maxLength={100} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <button className="btn btn-primary"><Plus size={16} /> Dodaj</button>
        </form>
      </section>

      <section className="card">
        <h2>Nieprzypisane czujniki</h2>
        {sensors.length === 0 ? (
          <p className="muted">Wszystkie czujniki są przypisane. Nowe pojawią się tu same po pierwszym pomiarze z płytki.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Czujnik (ROM)</th><th>Płytka</th><th>Temperatura</th><th>Ostatni pomiar</th><th>Obecny</th></tr></thead>
            <tbody>
              {sensors.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.id}</td>
                  <td className="mono">{s.board_id}</td>
                  <td>{formatTemp(s.last_temp)} °C</td>
                  <td>{timeAgo(s.last_ts)}</td>
                  <td>{s.present ? 'tak' : 'nie'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">Którą sondę trzymasz? Ogrzej ją w dłoni - po najbliższym pomiarze (co 5 min) jej temperatura wzrośnie.</p>
      </section>

      <section className="card">
        <h2>Lodówki</h2>
        <table className="table">
          <thead><tr><th>Nazwa</th><th>Stan</th><th>Czujnik</th><th>Temperatura</th><th>Użytkownicy</th><th>Aktywna</th><th /></tr></thead>
          <tbody>
            {fridges.map((f) => (
              <tr key={f.id} className={f.is_active ? '' : 'row-disabled'}>
                <td>
                  <Link to={`/fridges/${f.id}`}>{f.name}</Link>
                  {f.location && <div className="muted small">{f.location}</div>}
                </td>
                <td><StateBadge state={f.state} /></td>
                <td>
                  {f.sensor ? (
                    <div className="mono small">{f.sensor.id}<div className="muted">{f.sensor.board_id}</div></div>
                  ) : (
                    <div className="input-with-button">
                      <select value={choice[f.id] || ''} onChange={(e) => setChoice({ ...choice, [f.id]: e.target.value })}>
                        <option value="">wybierz czujnik…</option>
                        {sensors.map((s) => <option key={s.id} value={s.id}>{s.id} ({formatTemp(s.last_temp)} °C)</option>)}
                      </select>
                      <button className="btn btn-secondary btn-sm" disabled={!choice[f.id]} onClick={() => assign(f)} title="Przypisz"><Link2 size={14} /></button>
                    </div>
                  )}
                </td>
                <td>{formatTemp(f.last_temp)} °C <div className="muted small">{timeAgo(f.last_ts)}</div></td>
                <td>{f.users_count}</td>
                <td>
                  <input type="checkbox" checked={f.is_active} onChange={(e) => act(() => api.patch(`/admin/fridges/${f.id}`, { is_active: e.target.checked }))} />
                </td>
                <td className="row-actions">
                  {f.sensor && (
                    <button className="btn btn-ghost btn-icon" title="Odepnij czujnik (np. wymiana sondy)"
                      onClick={() => window.confirm(`Odpiąć czujnik od „${f.name}”? Historia zostaje przy lodówce.`) && act(() => api.post(`/admin/fridges/${f.id}/unassign`), 'Odpięto czujnik')}>
                      <Link2Off size={16} />
                    </button>
                  )}
                  <button className="btn btn-ghost btn-icon" title="Edytuj" onClick={() => edit(f)}><Pencil size={16} /></button>
                  <button className="btn btn-ghost btn-icon danger" title="Usuń"
                    onClick={() => window.confirm(`Usunąć lodówkę „${f.name}”?`) && act(() => api.delete(`/admin/fridges/${f.id}`), 'Usunięto lodówkę')}>
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {fridges.length === 0 && <p className="muted">Brak lodówek.</p>}
      </section>
    </div>
  );
}
