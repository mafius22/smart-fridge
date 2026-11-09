import { useState } from 'react';
import api, { apiError } from '../api/client';

const toInput = (v) => (v === null || v === undefined ? '' : String(v));
const MAX_DELAY_MIN = 240;

function parseTemp(value) {
  const normalized = value.trim().replace(',', '.');
  if (normalized === '') return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export default function FridgeSettingsForm({ fridge, folders, onSaved }) {
  const [form, setForm] = useState(() => ({
    custom_name: fridge.custom_name || '',
    folder_id: fridge.folder_id ?? '',
    min_temp: toInput(fridge.settings.min_temp),
    max_temp: toInput(fridge.settings.max_temp),
    notify_low: fridge.settings.notify_low,
    notify_high: fridge.settings.notify_high,
    notify_fault: fridge.settings.notify_fault,
    alert_delay_min: String(fridge.settings.alert_delay_min ?? 0),
  }));
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    const min = parseTemp(form.min_temp);
    const max = parseTemp(form.max_temp);
    if (Number.isNaN(min) || Number.isNaN(max)) return setMessage({ type: 'error', text: 'Progi muszą być liczbami' });
    if (min !== null && max !== null && min >= max) return setMessage({ type: 'error', text: 'Próg minimalny musi być niższy od maksymalnego' });
    const delay = form.alert_delay_min.trim() === '' ? 0 : Number(form.alert_delay_min);
    if (!Number.isInteger(delay) || delay < 0 || delay > MAX_DELAY_MIN) {
      return setMessage({ type: 'error', text: `Opóźnienie musi być liczbą minut od 0 do ${MAX_DELAY_MIN}` });
    }

    setBusy(true);
    try {
      const res = await api.patch(`/fridges/${fridge.id}/prefs`, {
        custom_name: form.custom_name.trim() || null,
        folder_id: form.folder_id === '' ? null : Number(form.folder_id),
        min_temp: min,
        max_temp: max,
        notify_low: form.notify_low,
        notify_high: form.notify_high,
        notify_fault: form.notify_fault,
        alert_delay_min: delay,
      });
      setMessage({ type: 'success', text: 'Zapisano' });
      onSaved?.(res.data.fridge);
    } catch (err) {
      setMessage({ type: 'error', text: apiError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label className="field">
        <span>Moja nazwa (widzę tylko ja)</span>
        <input value={form.custom_name} maxLength={100} placeholder={fridge.name} onChange={set('custom_name')} />
      </label>
      <label className="field">
        <span>Folder</span>
        <select value={form.folder_id} onChange={set('folder_id')}>
          <option value="">Bez folderu</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>

      <div className="grid-2">
        <div className="threshold">
          <label className="field">
            <span>Próg minimalny °C</span>
            <input inputMode="decimal" value={form.min_temp} placeholder="brak" onChange={set('min_temp')} />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.notify_low} onChange={set('notify_low')} />
            Powiadom, gdy niżej
          </label>
        </div>
        <div className="threshold">
          <label className="field">
            <span>Próg maksymalny °C</span>
            <input inputMode="decimal" value={form.max_temp} placeholder="brak" onChange={set('max_temp')} />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.notify_high} onChange={set('notify_high')} />
            Powiadom, gdy wyżej
          </label>
        </div>
      </div>

      <label className="field">
        <span>Powiadom, gdy temperatura jest poza progiem dłużej niż (min)</span>
        <input type="number" min={0} max={MAX_DELAY_MIN} step={1} value={form.alert_delay_min} onChange={set('alert_delay_min')} />
      </label>
      <p className="muted small">
        0 = od razu. Dla lodówek z odszranianiem albo często otwieranych zwykle 20-45 min - krótsze przekroczenie
        widać w aplikacji jako „Przekroczenie”, ale bez powiadomienia.
      </p>

      <label className="check">
        <input type="checkbox" checked={form.notify_fault} onChange={set('notify_fault')} />
        Powiadom o awariach (płytka offline, czujnik nie odpowiada lub odłączony) - zawsze od razu
      </label>

      <p className="muted small">
        Alarm przychodzi raz, gdy temperatura przekroczy próg, i drugi raz, gdy wróci do normy
        (co najmniej 0,5 °C od progu). Przekroczenia z czasu przerwy w łączności dostaniesz jako jedno podsumowanie.
      </p>

      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Zapisywanie…' : 'Zapisz ustawienia'}</button>
    </form>
  );
}
