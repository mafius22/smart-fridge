import { useCallback, useState } from 'react';
import { KeyRound, Lock, Unlock, Trash2, UserPlus, Refrigerator } from 'lucide-react';
import api, { apiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import Modal from '../../components/Modal';
import { randomPassword } from '../../utils/format';
import usePolling from '../../utils/usePolling';

const EMPTY_FORM = { email: '', display_name: '', role: 'user', password: '' };

function AccessModal({ user, fridges, onClose, onSaved }) {
  const [selected, setSelected] = useState(new Set(user.fridge_ids));
  const [error, setError] = useState('');

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const save = async () => {
    try {
      await api.put(`/admin/users/${user.id}/fridges`, { fridge_ids: [...selected] });
      onSaved();
    } catch (err) {
      setError(apiError(err));
    }
  };

  return (
    <Modal
      title={`Dostęp: ${user.display_name || user.email}`}
      onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Anuluj</button><button className="btn btn-primary" onClick={save}>Zapisz</button></>}
    >
      {fridges.length === 0 && <p className="muted">Brak lodówek - utwórz je w „Lodówki i czujniki”.</p>}
      <div className="checklist">
        {fridges.map((f) => (
          <label key={f.id} className="check">
            <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
            {f.name} {f.location && <span className="muted small">({f.location})</span>}
            {!f.is_active && <span className="muted small"> - nieaktywna</span>}
          </label>
        ))}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [fridges, setFridges] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState(null);
  const [accessUser, setAccessUser] = useState(null);

  const load = useCallback(async () => {
    try {
      const [u, f] = await Promise.all([api.get('/admin/users'), api.get('/admin/fridges')]);
      setUsers(u.data.users);
      setFridges(f.data.fridges);
    } catch (err) {
      setMessage({ type: 'error', text: apiError(err) });
    }
  }, []);

  usePolling(load, 60000);

  const act = async (fn, okText) => {
    try {
      await fn();
      if (okText) setMessage({ type: 'success', text: okText });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: apiError(err) });
    }
  };

  const createUser = (e) => {
    e.preventDefault();
    const payload = { ...form, display_name: form.display_name.trim() || null };
    act(async () => {
      await api.post('/admin/users', payload);
      setForm(EMPTY_FORM);
    }, `Utworzono konto ${form.email}. Hasło startowe: ${form.password} - przekaż je użytkownikowi, zmieni je przy pierwszym logowaniu.`);
  };

  const resetPassword = (u) => {
    const password = window.prompt(`Nowe hasło startowe dla ${u.email} (min. 10 znaków):`, randomPassword());
    if (password) {
      act(() => api.post(`/admin/users/${u.id}/reset-password`, { password }),
        `Hasło startowe dla ${u.email}: ${password} - użytkownik zmieni je przy logowaniu.`);
    }
  };

  const fridgeNames = (ids) => ids.map((id) => fridges.find((f) => f.id === id)?.name).filter(Boolean).join(', ');

  return (
    <div className="page">
      <h1>Użytkownicy</h1>
      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

      <section className="card">
        <h2>Nowe konto</h2>
        <form className="form-grid" onSubmit={createUser}>
          <label className="field"><span>E-mail</span>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label className="field"><span>Nazwa</span>
            <input value={form.display_name} maxLength={100} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </label>
          <label className="field"><span>Rola</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="user">użytkownik</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <label className="field"><span>Hasło startowe (min. 10)</span>
            <div className="input-with-button">
              <input value={form.password} minLength={10} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ ...form, password: randomPassword() })}>Generuj</button>
            </div>
          </label>
          <button className="btn btn-primary"><UserPlus size={16} /> Utwórz</button>
        </form>
      </section>

      <section className="card">
        <table className="table">
          <thead>
            <tr><th>E-mail</th><th>Nazwa</th><th>Rola</th><th>Status</th><th>Lodówki</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMe = u.id === me.id;
              return (
                <tr key={u.id} className={u.is_active ? '' : 'row-disabled'}>
                  <td>{u.email}{isMe && <span className="muted small"> (Ty)</span>}</td>
                  <td>{u.display_name || '-'}</td>
                  <td>
                    <select value={u.role} disabled={isMe} onChange={(e) => act(() => api.patch(`/admin/users/${u.id}`, { role: e.target.value }))}>
                      <option value="user">użytkownik</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    {u.is_active ? 'aktywne' : 'zablokowane'}
                    {u.must_change_password && <div className="muted small">hasło startowe</div>}
                  </td>
                  <td className="small">{u.role === 'admin' ? 'wszystkie' : (fridgeNames(u.fridge_ids) || 'brak')}</td>
                  <td className="row-actions">
                    {u.role !== 'admin' && (
                      <button className="btn btn-ghost btn-icon" title="Dostęp do lodówek" onClick={() => setAccessUser(u)}><Refrigerator size={16} /></button>
                    )}
                    <button className="btn btn-ghost btn-icon" title="Ustaw hasło startowe" onClick={() => resetPassword(u)}><KeyRound size={16} /></button>
                    {!isMe && (
                      <>
                        <button className="btn btn-ghost btn-icon" title={u.is_active ? 'Zablokuj' : 'Odblokuj'}
                          onClick={() => act(() => api.patch(`/admin/users/${u.id}`, { is_active: !u.is_active }))}>
                          {u.is_active ? <Lock size={16} /> : <Unlock size={16} />}
                        </button>
                        <button className="btn btn-ghost btn-icon danger" title="Usuń"
                          onClick={() => window.confirm(`Usunąć konto ${u.email}?`) && act(() => api.delete(`/admin/users/${u.id}`), 'Usunięto konto')}>
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {accessUser && (
        <AccessModal
          user={accessUser}
          fridges={fridges}
          onClose={() => setAccessUser(null)}
          onSaved={() => { setAccessUser(null); act(() => Promise.resolve(), 'Zapisano dostęp'); }}
        />
      )}
    </div>
  );
}
