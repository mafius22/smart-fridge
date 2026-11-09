import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import ChangePasswordForm from '../components/ChangePasswordForm';

export default function ChangePasswordPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1>Zmiana hasła</h1>
        {user?.must_change_password && (
          <p className="muted">To pierwsze logowanie. Ustaw własne hasło, aby korzystać z aplikacji.</p>
        )}
        <ChangePasswordForm onDone={() => navigate('/', { replace: true })} />
        <button className="btn btn-ghost btn-block" onClick={logout}>Wyloguj</button>
      </div>
    </div>
  );
}
