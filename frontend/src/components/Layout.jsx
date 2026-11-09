import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, LogOut, Settings, Users, Refrigerator, Cpu } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { syncPushSubscription } from '../utils/push';

export default function Layout() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  useEffect(() => { syncPushSubscription(); }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <LayoutDashboard size={22} />
          <span>Smart Fridge</span>
        </div>

        <nav className="nav">
          <NavLink to="/" end><Refrigerator size={16} /> Lodówki</NavLink>
          {isAdmin && (
            <>
              <NavLink to="/admin/users"><Users size={16} /> Użytkownicy</NavLink>
              <NavLink to="/admin/fridges"><Refrigerator size={16} /> Lodówki i czujniki</NavLink>
              <NavLink to="/admin/boards"><Cpu size={16} /> Płytki</NavLink>
            </>
          )}
          <NavLink to="/settings"><Settings size={16} /> Ustawienia</NavLink>
        </nav>

        <div className="user-box">
          <span className="user-name" title={user?.email}>
            {user?.display_name || user?.email}
            {isAdmin && <span className="role-tag">admin</span>}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={logout} title="Wyloguj">
            <LogOut size={16} /> Wyloguj
          </button>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
