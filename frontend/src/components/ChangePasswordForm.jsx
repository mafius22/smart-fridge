import { useState } from 'react';
import api, { apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const MIN_LENGTH = 10;

export default function ChangePasswordForm({ onDone }) {
  const { setUser } = useAuth();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (form.next.length < MIN_LENGTH) return setError(`Nowe hasło musi mieć co najmniej ${MIN_LENGTH} znaków`);
    if (form.next !== form.confirm) return setError('Hasła nie są takie same');
    setBusy(true);
    try {
      const res = await api.post('/auth/change-password', { current_password: form.current, new_password: form.next });
      setUser(res.data.user);
      setForm({ current: '', next: '', confirm: '' });
      setSuccess('Hasło zmienione. Inne urządzenia zostały wylogowane.');
      onDone?.();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="stack">
      <label className="field">
        <span>Obecne hasło</span>
        <input type="password" autoComplete="current-password" value={form.current} onChange={set('current')} required />
      </label>
      <label className="field">
        <span>Nowe hasło (min. {MIN_LENGTH} znaków)</span>
        <input type="password" autoComplete="new-password" value={form.next} onChange={set('next')} required />
      </label>
      <label className="field">
        <span>Powtórz nowe hasło</span>
        <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
      </label>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Zapisywanie…' : 'Zmień hasło'}</button>
    </form>
  );
}
