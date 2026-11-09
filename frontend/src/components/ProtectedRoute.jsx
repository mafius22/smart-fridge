import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function ProtectedRoute({ children, adminOnly = false, allowPendingPassword = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="page-loading">Ładowanie…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.must_change_password && !allowPendingPassword) return <Navigate to="/change-password" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}
