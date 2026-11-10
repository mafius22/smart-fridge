import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ChevronRight, ExternalLink, Link2, Link2Off, Pencil, Plus, Thermometer, Trash2,
} from 'lucide-react';
import api, { apiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useDialogs } from '@/components/DialogsProvider';
import Field from '@/components/Field';
import IconAction from '@/components/IconAction';
import PageHeader from '@/components/PageHeader';
import StateBadge from '@/components/StateBadge';
import SwitchRow from '@/components/SwitchRow';
import usePolling from '@/utils/usePolling';
import { formatTemp, timeAgo } from '@/utils/format';

const EMPTY_FORM = { name: '', location: '' };

function ZoneForm({ initial, submitText, onSubmit, onCancel, autoFocus }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    await onSubmit({ name: form.name.trim(), location: form.location.trim() || null });
    setBusy(false);
  };
  const unchanged = form.name.trim() === initial.name && form.location.trim() === initial.location;
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <Field label="Nazwa">
        <Input value={form.name} maxLength={100} required autoFocus={autoFocus} placeholder="np. Chłodnia nabiał"
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Lokalizacja">
        <Input value={form.location} maxLength={100} placeholder="opcjonalnie"
          onChange={(e) => setForm({ ...form, location: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Anuluj</Button>}
        <Button type="submit" disabled={busy || !form.name.trim() || (!onCancel && unchanged)}>{submitText}</Button>
      </div>
    </form>
  );
}

function SensorSelect({ sensors, value, onChange, className }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={cn('w-48', className)} aria-label="Czujnik">
        <SelectValue placeholder="wybierz czujnik…" />
      </SelectTrigger>
      <SelectContent>
        {sensors.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <span className="font-mono text-xs">{s.id}</span>
            <span className="text-muted-foreground">{formatTemp(s.last_temp)} °C</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AssignSensor({ sensors, onAssign, className }) {
  const [sensorId, setSensorId] = useState('');
  if (sensors.length === 0) return <span className="text-xs text-muted-foreground">brak wolnych czujników</span>;
  return (
    <div className="flex items-center gap-1.5">
      <SensorSelect sensors={sensors} value={sensorId} onChange={setSensorId} className={className} />
      <Button size="sm" variant="secondary" disabled={!sensorId} onClick={() => onAssign(sensorId)}>
        <Link2 /> Przypisz
      </Button>
    </div>
  );
}

// Szczegoly strefy: nazwa i lokalizacja, aktywnosc, czujnik, usuniecie
function ZoneDialog({ zone, sensors, onClose, act, onUnassign, onAssign, onDelete }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* Bez automatycznego fokusu na polu nazwy - na telefonie nie wyskakuje klawiatura przy samym podgladzie */}
      <DialogContent className="max-h-[90svh] gap-5 overflow-y-auto sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">{zone.name} <StateBadge state={zone.state} /></DialogTitle>
          <DialogDescription>
            {zone.users_count} {zone.users_count === 1 ? 'użytkownik' : 'użytkowników'} z dostępem
          </DialogDescription>
        </DialogHeader>

        <ZoneForm
          key={`${zone.name}|${zone.location || ''}`}
          initial={{ name: zone.name, location: zone.location || '' }}
          submitText="Zapisz"
          onSubmit={(patch) => act(() => api.patch(`/admin/fridges/${zone.id}`, patch))}
        />

        <SwitchRow
          label="Aktywna"
          description="Wyłączona strefa jest niewidoczna dla użytkowników i nie alarmuje; historia zostaje."
          checked={zone.is_active}
          onCheckedChange={(v) => act(() => api.patch(`/admin/fridges/${zone.id}`, { is_active: v }), v ? 'Włączono strefę' : 'Wyłączono strefę')}
        />

        <Separator />

        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">Czujnik</h3>
          {zone.sensor ? (
            <div className="flex items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-foreground/10">
              <Thermometer className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs">{zone.sensor.id}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{zone.sensor.board_id}</div>
              </div>
              <div className="text-right">
                <div className="tabular text-sm font-medium">{formatTemp(zone.last_temp)} °C</div>
                <div className="text-xs text-muted-foreground">{timeAgo(zone.last_ts)}</div>
              </div>
              <IconAction label="Odepnij czujnik" icon={Link2Off} onClick={() => onUnassign(zone)} />
            </div>
          ) : (
            <AssignSensor sensors={sensors} onAssign={(sensorId) => onAssign(zone, sensorId)} className="flex-1" />
          )}
        </section>

        <Separator />

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to={`/fridges/${zone.id}`}><ExternalLink /> Strona strefy</Link>
          </Button>
          <Button variant="destructive" className="sm:ml-auto" onClick={() => onDelete(zone)}><Trash2 /> Usuń strefę</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function FridgesAdminPage() {
  const { confirm, prompt } = useDialogs();
  const [fridges, setFridges] = useState([]);
  const [sensors, setSensors] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [f, s] = await Promise.all([api.get('/admin/fridges'), api.get('/admin/sensors', { params: { unassigned: 1 } })]);
      setFridges(f.data.fridges);
      setSensors(s.data.sensors);
    } catch (err) {
      toast.error(apiError(err));
    }
  }, []);

  usePolling(load, 30000);

  const act = async (fn, okText) => {
    try {
      const res = await fn();
      toast.success(okText || res?.data?.message || 'Zapisano');
      await load();
      return true;
    } catch (err) {
      toast.error(apiError(err));
      return false;
    }
  };

  const create = async (payload) => {
    const ok = await act(() => api.post('/admin/fridges', payload), 'Dodano strefę');
    if (ok) setCreateOpen(false);
  };

  const remove = async (f) => {
    const ok = await confirm({ title: `Usunąć strefę „${f.name}”?`, confirmText: 'Usuń', destructive: true });
    if (!ok) return;
    try {
      const res = await api.delete(`/admin/fridges/${f.id}`);
      toast.success(res.data.message || 'Usunięto strefę');
      setSelectedId(null);
      await load();
    } catch (err) {
      if (err.response?.data?.code !== 'has_history') return toast.error(apiError(err));
      // Strefa z historia: usuniecie na stale tylko po wpisaniu nazwy
      const typed = await prompt({
        title: 'Usunąć na stałe?',
        description: `${apiError(err)}\n\nTego NIE da się cofnąć: znikną pomiary, alarmy oraz dostępy i ustawienia użytkowników. `
          + 'Zamiast tego możesz wyłączyć strefę przełącznikiem „Aktywna”.',
        label: `Wpisz nazwę strefy: ${f.name}`,
        confirmText: 'Usuń na stałe',
        destructive: true,
      });
      if (typed === null) return;
      const deleted = await act(
        () => api.delete(`/admin/fridges/${f.id}`, { params: { force: 1 }, data: { confirm_name: typed.trim() } }),
        'Usunięto strefę z historią',
      );
      if (deleted) setSelectedId(null);
    }
  };

  const unassign = async (f) => {
    const ok = await confirm({
      title: `Odpiąć czujnik od „${f.name}”?`,
      description: 'Np. przy wymianie sondy. Historia pomiarów zostaje przy strefie.',
      confirmText: 'Odepnij',
    });
    if (ok) act(() => api.post(`/admin/fridges/${f.id}/unassign`), 'Odpięto czujnik');
  };

  const assign = (f, sensorId) => act(
    () => api.post(`/admin/fridges/${f.id}/assign`, { sensor_id: sensorId }),
    'Przypisano czujnik - nowe pomiary trafiają do tej strefy',
  );

  // Dane z listy (odswiezanej po kazdej zmianie), a nie kopia z chwili otwarcia okna
  const selectedZone = fridges.find((f) => f.id === selectedId);
  // Kontrolki w wierszu nie otwieraja szczegolow
  const stop = (e) => e.stopPropagation();

  return (
    <>
      <PageHeader title="Strefy i czujniki" description="Strefy, przypisanie sond i nowe czujniki z płytek.">
        <Button onClick={() => setCreateOpen(true)}><Plus /> Nowa strefa</Button>
      </PageHeader>

      <Card>
        <CardContent>
          {fridges.length === 0 ? <p className="text-sm text-muted-foreground">Brak stref.</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nazwa</TableHead>
                  <TableHead>Stan</TableHead>
                  <TableHead className="hidden md:table-cell">Czujnik</TableHead>
                  <TableHead className="hidden md:table-cell">Temperatura</TableHead>
                  <TableHead>Użytk.</TableHead>
                  <TableHead className="hidden md:table-cell">Aktywna</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Akcje</TableHead>
                  <TableHead className="w-6 md:hidden" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fridges.map((f) => (
                  <TableRow
                    key={f.id}
                    tabIndex={0}
                    onClick={() => setSelectedId(f.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(f.id); }}
                    className={cn('cursor-pointer', !f.is_active && 'opacity-60')}
                  >
                    <TableCell className="max-w-48 whitespace-normal">
                      <div className="font-medium">{f.name}</div>
                      {f.location && <div className="truncate text-xs text-muted-foreground">{f.location}</div>}
                    </TableCell>
                    <TableCell><StateBadge state={f.state} /></TableCell>
                    <TableCell className="hidden md:table-cell" onClick={stop} onKeyDown={stop}>
                      {f.sensor ? (
                        <div className="font-mono text-xs">
                          {f.sensor.id}
                          <div className="text-muted-foreground">{f.sensor.board_id}</div>
                        </div>
                      ) : (
                        <AssignSensor sensors={sensors} onAssign={(sensorId) => assign(f, sensorId)} />
                      )}
                    </TableCell>
                    <TableCell className="hidden tabular md:table-cell">
                      {formatTemp(f.last_temp)} °C
                      <div className="text-xs text-muted-foreground">{timeAgo(f.last_ts)}</div>
                    </TableCell>
                    <TableCell className="tabular">{f.users_count}</TableCell>
                    <TableCell className="hidden md:table-cell" onClick={stop} onKeyDown={stop}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <Switch
                              checked={f.is_active}
                              aria-label={`Strefa ${f.name} aktywna`}
                              onCheckedChange={(v) => act(() => api.patch(`/admin/fridges/${f.id}`, { is_active: v }), v ? 'Włączono strefę' : 'Wyłączono strefę')}
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{f.is_active ? 'Wyłącz: bez alarmów, niewidoczna' : 'Włącz'}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="hidden md:table-cell" onClick={stop} onKeyDown={stop}>
                      <div className="flex justify-end gap-0.5">
                        {f.sensor && <IconAction label="Odepnij czujnik" icon={Link2Off} onClick={() => unassign(f)} />}
                        <IconAction label="Edytuj" icon={Pencil} onClick={() => setSelectedId(f.id)} />
                        <IconAction label="Usuń strefę" icon={Trash2} destructive onClick={() => remove(f)} />
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground md:hidden"><ChevronRight className="size-4" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nieprzypisane czujniki</CardTitle>
          <CardDescription>
            Którą sondę trzymasz? Ogrzej ją w dłoni - po zresetowaniu płytki lub najbliższym pomiarze jej temperatura wzrośnie.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sensors.length === 0 ? (
            <p className="text-sm text-muted-foreground">Wszystkie czujniki są przypisane. Nowe pojawią się tu same po pierwszym pomiarze z płytki.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Czujnik (ROM)</TableHead>
                  <TableHead className="hidden sm:table-cell">Płytka</TableHead>
                  <TableHead>Temperatura</TableHead>
                  <TableHead className="hidden sm:table-cell">Ostatni pomiar</TableHead>
                  <TableHead className="hidden sm:table-cell">Obecny</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sensors.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.id}</TableCell>
                    <TableCell className="hidden font-mono text-xs sm:table-cell">{s.board_id}</TableCell>
                    <TableCell className="tabular">{formatTemp(s.last_temp)} °C</TableCell>
                    <TableCell className="hidden sm:table-cell">{timeAgo(s.last_ts)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{s.present ? <StateBadge tone="ok" label="tak" /> : <StateBadge tone="alarm" label="nie" />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nowa strefa</DialogTitle>
            <DialogDescription>Potem przypisz do niej czujnik i nadaj użytkownikom dostęp.</DialogDescription>
          </DialogHeader>
          {createOpen && (
            <ZoneForm initial={EMPTY_FORM} submitText="Dodaj" autoFocus onSubmit={create} onCancel={() => setCreateOpen(false)} />
          )}
        </DialogContent>
      </Dialog>

      {selectedZone && (
        <ZoneDialog
          key={selectedZone.id}
          zone={selectedZone}
          sensors={sensors}
          onClose={() => setSelectedId(null)}
          act={act}
          onUnassign={unassign}
          onAssign={assign}
          onDelete={remove}
        />
      )}
    </>
  );
}
