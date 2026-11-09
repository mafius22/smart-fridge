import { useEffect, useState } from 'react';
import { Bell, BellOff, Send } from 'lucide-react';
import api, { apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import ChangePasswordForm from '../components/ChangePasswordForm';
import { disablePush, enablePush, getBrowserSubscription, pushSupported } from '../utils/push';

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [profileMsg, setProfileMsg] = useState(null);
  const [browserPush, setBrowserPush] = useState(null); // null = sprawdzam
  const [pushMsg, setPushMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBrowserSubscription().then((sub) => setBrowserPush(Boolean(sub))).catch(() => setBrowserPush(false));
  }, []);

  const saveProfile = async (patch) => {
    try {
      const res = await api.patch('/auth/me', patch);
      setUser(res.data.user);
      setProfileMsg({ type: 'success', text: 'Zapisano' });
    } catch (err) {
      setProfileMsg({ type: 'error', text: apiError(err) });
    }
  };

  const runPush = async (fn, okText) => {
    setBusy(true);
    setPushMsg(null);
    try {
      await fn();
      setPushMsg({ type: 'success', text: okText });
    } catch (err) {
      setPushMsg({ type: 'error', text: apiError(err) });
    } finally {
      setBusy(false);
      getBrowserSubscription().then((sub) => setBrowserPush(Boolean(sub))).catch(() => {});
    }
  };

  return (
    <div className="page narrow">
      <h1>Ustawienia</h1>

      <section className="card">
        <h2>Profil</h2>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); saveProfile({ display_name: displayName.trim() || null }); }}>
          <label className="field">
            <span>E-mail (login)</span>
            <input value={user.email} disabled />
          </label>
          <label className="field">
            <span>Nazwa wyświetlana</span>
            <input value={displayName} maxLength={100} placeholder={user.email} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          {profileMsg && <div className={`alert alert-${profileMsg.type}`}>{profileMsg.text}</div>}
          <button className="btn btn-primary">Zapisz</button>
        </form>
      </section>

      <section className="card">
        <h2>Powiadomienia</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={user.notifications_enabled}
            onChange={(e) => saveProfile({ notifications_enabled: e.target.checked })}
          />
          Wysyłaj mi powiadomienia (wyłączenie wstrzymuje wszystkie, alarmy nadal są zapisywane)
        </label>

        <div className="push-box">
          <div>
            <strong>Ta przeglądarka / telefon</strong>
            <div className="muted small">
              {!pushSupported() && 'Przeglądarka nie obsługuje powiadomień push (na iPhone: dodaj aplikację do ekranu początkowego).'}
              {pushSupported() && browserPush === null && 'Sprawdzam…'}
              {pushSupported() && browserPush === true && 'Powiadomienia włączone na tym urządzeniu.'}
              {pushSupported() && browserPush === false && 'Powiadomienia wyłączone na tym urządzeniu.'}
            </div>
          </div>
          {pushSupported() && (
            <div className="row-actions">
              {browserPush ? (
                <>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => runPush(() => api.post('/push/test'), 'Wysłano powiadomienie testowe')}>
                    <Send size={16} /> Test
                  </button>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => runPush(disablePush, 'Wyłączono powiadomienia na tym urządzeniu')}>
                    <BellOff size={16} /> Wyłącz
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" disabled={busy} onClick={() => runPush(enablePush, 'Włączono powiadomienia na tym urządzeniu')}>
                  <Bell size={16} /> Włącz
                </button>
              )}
            </div>
          )}
        </div>
        {pushMsg && <div className={`alert alert-${pushMsg.type}`}>{pushMsg.text}</div>}
        <p className="muted small">Progi i rodzaje alarmów ustawiasz osobno dla każdej lodówki na jej stronie.</p>
      </section>

      <section className="card">
        <h2>Zmiana hasła</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
