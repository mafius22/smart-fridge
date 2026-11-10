import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { apiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import AuthShell from '@/components/AuthShell';
import Field from '@/components/Field';
import FormMessage from '@/components/FormMessage';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const loggedIn = await login(email, password);
      const target = loggedIn.must_change_password ? '/change-password' : (location.state?.from?.pathname || '/');
      navigate(target, { replace: true });
    } catch (err) {
      setError(apiError(err, 'Nie udało się zalogować'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Logowanie</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onSubmit}>
            <Field label="E-mail">
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            <Field label="Hasło">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <FormMessage message={error ? { type: 'error', text: error } : null} />
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Zaloguj
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
