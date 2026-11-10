import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronRight, KeyRound, LayoutGrid, Lock, Trash2, Unlock, Plus, Wand2,
} from 'lucide-react';
import api, { apiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useDialogs } from '@/components/DialogsProvider';
import Field from '@/components/Field';
import FormMessage from '@/components/FormMessage';
import IconAction from '@/components/IconAction';
import PageHeader from '@/components/PageHeader';
import StateBadge from '@/components/StateBadge';
import { randomPassword } from '@/utils/format';
import usePolling from '@/utils/usePolling';

const EMPTY_FORM = { email: '', display_name: '', role: 'user', password: '' };
const ROLE_LABELS = { user: 'użytkownik', admin: 'admin' };

function RoleSelect({ value, onChange, disabled, className }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size="sm" className={cn('w-32', className)} aria-label="Rola"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="user">{ROLE_LABELS.user}</SelectItem>
        <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function UserStatus({ user }) {
  return (
    <div className="flex flex-col items-start gap-1">
      {user.is_active ? <StateBadge tone="ok" label="aktywne" /> : <StateBadge tone="alarm" label="zablokowane" />}
      {user.must_change_password && <span className="text-xs text-muted-foreground">hasło startowe</span>}
    </div>
  );
}

function CreateUserDialog({ open, onOpenChange, onCreate }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onCreate({ ...form, email: form.email.trim(), display_name: form.display_name.trim() || null });
    setBusy(false);
    if (ok) setForm(EMPTY_FORM);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Nowy użytkownik</DialogTitle>
            <DialogDescription>Użytkownik ustawi własne hasło przy pierwszym logowaniu.</DialogDescription>
          </DialogHeader>
          <Field label="E-mail">
            <Input type="email" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Nazwa">
            <Input value={form.display_name} maxLength={100} placeholder="opcjonalnie" onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </Field>
          <Field label="Rola">
            <RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} className="w-full" />
          </Field>
          <Field label="Hasło startowe" hint="Co najmniej 10 znaków. Przekaż je użytkownikowi.">
            <div className="flex gap-2">
              <Input value={form.password} minLength={10} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              <IconAction label="Generuj hasło" icon={Wand2} onClick={() => setForm({ ...form, password: randomPassword() })} />
            </div>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Anuluj</Button>
            <Button type="submit" disabled={busy}><Plus /> Utwórz</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Szczegoly konta: rola, dostep do stref, haslo, blokada, usuniecie
function UserDialog({ user, fridges, isMe, onClose, act, onResetPassword, onDelete }) {
  const [selected, setSelected] = useState(() => new Set(user.fridge_ids));
  const changed = selected.size !== user.fridge_ids.length || user.fridge_ids.some((id) => !selected.has(id));

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90svh] gap-5 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{user.display_name || user.email}{isMe && <span className="font-normal text-muted-foreground"> (Ty)</span>}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label>Rola</Label>
            <RoleSelect
              value={user.role}
              disabled={isMe}
              className="w-full"
              onChange={(role) => act(() => api.patch(`/admin/users/${user.id}`, { role }), 'Zmieniono rolę')}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <UserStatus user={user} />
          </div>
        </div>

        <Separator />

        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Dostęp do stref</h3>
            {user.role !== 'admin' && (
              <Button
                size="sm"
                disabled={!changed}
                onClick={() => act(() => api.put(`/admin/users/${user.id}/fridges`, { fridge_ids: [...selected] }), 'Zapisano dostęp')}
              >
                Zapisz ({selected.size})
              </Button>
            )}
          </div>
          {user.role === 'admin' ? (
            <p className="text-sm text-muted-foreground">Admin ma dostęp do wszystkich stref.</p>
          ) : fridges.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak stref - utwórz je w „Strefy i czujniki”.</p>
          ) : (
            <div className="grid max-h-64 gap-0.5 overflow-y-auto">
              {fridges.map((f) => (
                <Label key={f.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 font-normal hover:bg-muted">
                  <Checkbox checked={selected.has(f.id)} onCheckedChange={() => toggle(f.id)} />
                  <span className="grid">
                    <span>{f.name}</span>
                    {(f.location || !f.is_active) && (
                      <span className="text-xs text-muted-foreground">
                        {[f.location, !f.is_active && 'nieaktywna'].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                </Label>
              ))}
            </div>
          )}
        </section>

        <Separator />

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => onResetPassword(user)}><KeyRound /> Hasło startowe</Button>
          {!isMe && (
            <>
              <Button
                variant="outline"
                onClick={() => act(() => api.patch(`/admin/users/${user.id}`, { is_active: !user.is_active }), user.is_active ? 'Zablokowano konto' : 'Odblokowano konto')}
              >
                {user.is_active ? <><Lock /> Zablokuj</> : <><Unlock /> Odblokuj</>}
              </Button>
              <Button variant="destructive" className="sm:ml-auto" onClick={() => onDelete(user)}><Trash2 /> Usuń konto</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const { confirm, prompt } = useDialogs();
  const [users, setUsers] = useState([]);
  const [fridges, setFridges] = useState([]);
  // Haslo startowe zostaje na ekranie, az admin je przepisze (toast znika sam)
  const [notice, setNotice] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [u, f] = await Promise.all([api.get('/admin/users'), api.get('/admin/fridges')]);
      setUsers(u.data.users);
      setFridges(f.data.fridges);
    } catch (err) {
      toast.error(apiError(err));
    }
  }, []);

  usePolling(load, 60000);

  const act = async (fn, okText) => {
    try {
      await fn();
      if (okText) toast.success(okText);
      await load();
      return true;
    } catch (err) {
      toast.error(apiError(err));
      return false;
    }
  };

  const createUser = async (payload) => {
    const ok = await act(() => api.post('/admin/users', payload), `Utworzono konto ${payload.email}`);
    if (ok) {
      setCreateOpen(false);
      setNotice({
        type: 'success',
        text: `Konto ${payload.email} - hasło startowe: ${payload.password}\nPrzekaż je użytkownikowi, zmieni je przy pierwszym logowaniu.`,
      });
    }
    return ok;
  };

  const resetPassword = async (u) => {
    const password = await prompt({
      title: 'Nowe hasło startowe',
      description: `${u.email} - użytkownik zmieni je przy logowaniu. Wcześniejsze sesje zostaną wylogowane.`,
      label: 'Hasło (min. 10 znaków)',
      defaultValue: randomPassword(),
      confirmText: 'Ustaw',
    });
    if (!password) return;
    const ok = await act(() => api.post(`/admin/users/${u.id}/reset-password`, { password }), 'Ustawiono hasło startowe');
    if (ok) setNotice({ type: 'success', text: `Hasło startowe dla ${u.email}: ${password}` });
  };

  const deleteUser = async (u) => {
    const ok = await confirm({
      title: `Usunąć konto ${u.email}?`,
      description: 'Znikną jego foldery, ustawienia stref i subskrypcje powiadomień.',
      confirmText: 'Usuń', destructive: true,
    });
    if (ok && await act(() => api.delete(`/admin/users/${u.id}`), 'Usunięto konto')) setSelectedId(null);
  };

  const fridgeNames = (ids) => ids.map((id) => fridges.find((f) => f.id === id)?.name).filter(Boolean).join(', ');
  // Dane z listy (odswiezanej po kazdej zmianie), a nie kopia z chwili otwarcia okna
  const selectedUser = users.find((u) => u.id === selectedId);
  // Kontrolki w wierszu (rola, przyciski) nie otwieraja szczegolow
  const stop = (e) => e.stopPropagation();

  return (
    <>
      <PageHeader title="Użytkownicy" description="Konta, role i dostęp do stref.">
        <Button onClick={() => setCreateOpen(true)}><Plus /> Nowy użytkownik</Button>
      </PageHeader>

      {notice && (
        <div className="grid gap-2">
          <FormMessage message={notice} />
          <Button variant="ghost" size="sm" className="w-fit" onClick={() => setNotice(null)}>Ukryj</Button>
        </div>
      )}

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Konto</TableHead>
                <TableHead className="hidden md:table-cell">Rola</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Strefy</TableHead>
                <TableHead className="hidden text-right md:table-cell">Akcje</TableHead>
                <TableHead className="w-6 md:hidden" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const isMe = u.id === me.id;
                return (
                  <TableRow
                    key={u.id}
                    tabIndex={0}
                    onClick={() => setSelectedId(u.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(u.id); }}
                    className={cn('cursor-pointer', !u.is_active && 'opacity-60')}
                  >
                    <TableCell className="max-w-48 whitespace-normal">
                      <div className="font-medium">{u.display_name || u.email}{isMe && <span className="text-muted-foreground"> (Ty)</span>}</div>
                      {u.display_name && <div className="truncate text-xs text-muted-foreground">{u.email}</div>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell" onClick={stop} onKeyDown={stop}>
                      <RoleSelect value={u.role} disabled={isMe} onChange={(role) => act(() => api.patch(`/admin/users/${u.id}`, { role }), 'Zmieniono rolę')} />
                    </TableCell>
                    <TableCell><UserStatus user={u} /></TableCell>
                    <TableCell className="hidden max-w-56 whitespace-normal text-xs md:table-cell">
                      {u.role === 'admin' ? <span className="text-muted-foreground">wszystkie</span> : (fridgeNames(u.fridge_ids) || <span className="text-muted-foreground">brak</span>)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell" onClick={stop} onKeyDown={stop}>
                      <div className="flex justify-end gap-0.5">
                        {u.role !== 'admin' && <IconAction label="Dostęp do stref" icon={LayoutGrid} onClick={() => setSelectedId(u.id)} />}
                        <IconAction label="Ustaw hasło startowe" icon={KeyRound} onClick={() => resetPassword(u)} />
                        {!isMe && (
                          <>
                            <IconAction
                              label={u.is_active ? 'Zablokuj' : 'Odblokuj'}
                              icon={u.is_active ? Lock : Unlock}
                              onClick={() => act(() => api.patch(`/admin/users/${u.id}`, { is_active: !u.is_active }), u.is_active ? 'Zablokowano konto' : 'Odblokowano konto')}
                            />
                            <IconAction label="Usuń konto" icon={Trash2} destructive onClick={() => deleteUser(u)} />
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground md:hidden"><ChevronRight className="size-4" /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={createUser} />

      {selectedUser && (
        <UserDialog
          key={selectedUser.id}
          user={selectedUser}
          fridges={fridges}
          isMe={selectedUser.id === me.id}
          onClose={() => setSelectedId(null)}
          act={act}
          onResetPassword={resetPassword}
          onDelete={deleteUser}
        />
      )}
    </>
  );
}
