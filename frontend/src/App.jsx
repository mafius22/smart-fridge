import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import './App.css';

import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import DashboardPage from './pages/DashboardPage';
import FridgePage from './pages/FridgePage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/admin/UsersPage';
import FridgesAdminPage from './pages/admin/FridgesAdminPage';
import BoardsPage from './pages/admin/BoardsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/change-password"
        element={<ProtectedRoute allowPendingPassword><ChangePasswordPage /></ProtectedRoute>}
      />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="fridges/:id" element={<FridgePage />} />
        <Route path="settings" element={<SettingsPage />} />

        <Route path="admin" element={<ProtectedRoute adminOnly><Outlet /></ProtectedRoute>}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="fridges" element={<FridgesAdminPage />} />
          <Route path="boards" element={<BoardsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
