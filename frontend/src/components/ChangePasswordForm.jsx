import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import api, { apiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Field from '@/components/Field';
import FormMessage from '@/components/FormMessage';

const MIN_LENGTH = 10;

export default function ChangePasswordForm({ onDone }) {
  const { setUser } = useAuth();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    if (form.next.length < MIN_LENGTH) return setMessage({ type: 'error', text: `Nowe hasło musi mieć co najmniej ${MIN_LENGTH} znaków` });
    if (form.next !== form.confirm) return setMessage({ type: 'error', text: 'Hasła nie są takie same' });
    setBusy(true);
    try {
      const res = await api.post('/auth/change-password', { current_password: form.current, new_password: form.next });
      setUser(res.data.user);
      setForm({ current: '', next: '', confirm: '' });
      setMessage({ type: 'success', text: 'Hasło zmienione. Inne urządzenia zostały wylogowane.' });
      onDone?.();
    } catch (err) {
      setMessage({ type: 'error', text: apiError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <Field label="Obecne hasło">
        <Input type="password" autoComplete="current-password" value={form.current} onChange={set('current')} required />
      </Field>
      <Field label="Nowe hasło" hint={`Co najmniej ${MIN_LENGTH} znaków.`}>
        <Input type="password" autoComplete="new-password" value={form.next} onChange={set('next')} required />
      </Field>
      <Field label="Powtórz nowe hasło">
        <Input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
      </Field>
      <FormMessage message={message} />
      <Button type="submit" disabled={busy} className="w-full sm:w-fit">
        {busy && <Loader2 className="animate-spin" />}
        Zmień hasło
      </Button>
    </form>
  );
}
