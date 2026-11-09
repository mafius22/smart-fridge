import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { apiError } from '../api/client';

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
    <div className="auth-page">
      <form className="card auth-card" onSubmit={onSubmit}>
        <div className="auth-brand"><LayoutDashboard size={28} /> Smart Fridge</div>
        <h1>Logowanie</h1>
        <label className="field">
          <span>E-mail</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Hasło</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Logowanie…' : 'Zaloguj'}</button>
        <p className="muted small">Konto zakłada administrator.</p>
      </form>
    </div>
  );
}
