import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  Cpu, Download, MoreHorizontal, Pencil, Power, RotateCcw, Thermometer, Trash2,
} from 'lucide-react';
import api, { apiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useDialogs } from '@/components/DialogsProvider';
import IconAction from '@/components/IconAction';
import PageHeader from '@/components/PageHeader';
import PageLoading from '@/components/PageLoading';
import StateBadge from '@/components/StateBadge';
import usePolling from '@/utils/usePolling';
import { formatDateTime, formatTemp, timeAgo } from '@/utils/format';

const OTA_LABELS = {
  none: 'brak', pending: 'w toku', ok: 'OK', error: 'błąd', rollback: 'wycofano (rollback)',
};

function Stat({ label, children, className }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('tabular text-sm font-medium', className)}>{children}</dd>
    </div>
  );
}

export default function BoardsPage() {
  const { confirm, prompt } = useDialogs();
  const [boards, setBoards] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/admin/boards');
      setBoards(res.data.boards);
      setError('');
    } catch (err) {
      setError(apiError(err));
    }
  }, []);

  usePolling(load, 30000);

  const act = async (fn) => {
    try {
      const res = await fn();
      toast.success(res?.data?.message || 'Zapisano');
      await load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const label = (b) => b.name || b.id;

  const rename = async (b) => {
    const name = await prompt({ title: 'Nazwa płytki', label: 'Nazwa', hint: 'Puste = bez nazwy (widać ID).', defaultValue: b.name || '' });
    if (name !== null) act(() => api.patch(`/admin/boards/${b.id}`, { name: name.trim() || null }));
  };

  const reset = async (b) => {
    const ok = await confirm({
      title: `Zrestartować ${label(b)}?`,
      description: 'Restart nastąpi po najbliższym cyklu pomiarowym (do 5 min).',
      confirmText: 'Restartuj',
    });
    if (ok) act(() => api.post(`/admin/boards/${b.id}/reset`));
  };

  const update = async (b) => {
    const url = await prompt({
      title: 'Aktualizacja firmware',
      description: `${label(b)} - obecna wersja: ${b.fw || '?'}. Wynik pojawi się w polu „Ostatnie OTA”.`,
      label: 'Adres pliku .bin (https://)',
      placeholder: 'https://…/firmware.bin',
      confirmText: 'Wyślij',
    });
    if (url?.trim()) act(() => api.post(`/admin/boards/${b.id}/update`, { url: url.trim() }));
  };

  const toggleActive = async (b) => {
    const ok = await confirm(b.is_active
      ? {
        title: `Wyłączyć ${label(b)}?`,
        description: 'Backend przestanie zapisywać jej pomiary i alarmować; aktywne alarmy jej stref zostaną zamknięte.',
        confirmText: 'Wyłącz', destructive: true,
      }
      : { title: `Włączyć ${label(b)}?`, description: 'Pomiary znów będą zapisywane.', confirmText: 'Włącz' });
    if (ok) act(() => api.patch(`/admin/boards/${b.id}`, { is_active: !b.is_active }));
  };

  const removeBoard = async (b) => {
    const ok = await confirm({
      title: `Usunąć ${label(b)}?`,
      description: 'Razem z jej czujnikami i ich pomiarami bez strefy. Włączona płytka pojawi się ponownie - żeby ją odciąć, użyj „Wyłącz”.',
      confirmText: 'Usuń', destructive: true,
    });
    if (ok) act(() => api.delete(`/admin/boards/${b.id}`));
  };

  const removeSensor = async (s) => {
    const ok = await confirm({
      title: `Usunąć czujnik ${s.id}?`,
      description: 'Razem z jego pomiarami. Jeśli jest nadal podłączony, pojawi się ponownie po pomiarze.',
      confirmText: 'Usuń', destructive: true,
    });
    if (ok) act(() => api.delete(`/admin/sensors/${s.id}`));
  };

  if (boards === null) return <PageLoading error={error} />;

  return (
    <>
      <PageHeader title="Płytki" description="Status, czujniki i zdalne komendy." />
      {error && <p className="text-sm text-destructive">{error}</p>}

      {boards.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Cpu className="size-10 text-muted-foreground" />
            <p className="font-medium">Brak płytek</p>
            <p className="text-sm text-muted-foreground">Płytka pojawi się tu sama po pierwszej wiadomości MQTT.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {boards.map((b) => (
          <Card key={b.id} className={cn(!b.is_active && 'opacity-70')}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="size-4 text-muted-foreground" />
                <span className="truncate">{label(b)}</span>
              </CardTitle>
              {b.name && <CardDescription className="font-mono text-xs">{b.id}</CardDescription>}
              <CardAction className="flex items-center gap-1">
                {b.is_active
                  ? <StateBadge tone={b.online ? 'ok' : 'offline'} label={b.online ? 'online' : 'offline'} />
                  : <StateBadge tone="muted" label="wyłączona" />}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Akcje płytki ${label(b)}`}><MoreHorizontal /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => rename(b)}><Pencil /> Zmień nazwę</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => reset(b)}><RotateCcw /> Restart</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => update(b)}><Download /> Aktualizuj firmware</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => toggleActive(b)}><Power /> {b.is_active ? 'Wyłącz' : 'Włącz'}</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => removeBoard(b)}><Trash2 /> Usuń</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardAction>
            </CardHeader>

            <CardContent className="grid gap-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Stat label="Ostatnio widziana">{timeAgo(b.last_seen_at)}</Stat>
                <Stat label="Firmware">{b.fw || '-'}</Stat>
                <Stat label="Ostatnie OTA" className={cn((b.ota === 'error' || b.ota === 'rollback') && 'text-destructive')}>
                  {OTA_LABELS[b.ota] || '-'}
                </Stat>
                <Stat label="Wi-Fi (RSSI)">{b.rssi != null ? `${b.rssi} dBm` : '-'}</Stat>
                <Stat label="Bufor offline">{b.buffered != null ? `${b.buffered} pomiarów` : '-'}</Stat>
                <Stat label="Interwał">{b.interval_s ? `${b.interval_s / 60} min` : '-'}</Stat>
              </dl>
              <p className="text-xs text-muted-foreground">Ostatni status: {formatDateTime(b.last_status_at)}</p>
            </CardContent>

            <CardFooter className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Czujniki ({b.sensors.length})</div>
              {b.sensors.length === 0 ? <p className="text-sm text-muted-foreground">Brak</p> : (
                <ul className="grid gap-1.5">
                  {b.sensors.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 rounded-lg bg-background px-3 py-2 ring-1 ring-foreground/5">
                      <Thermometer className={cn('size-4 shrink-0', s.present ? 'text-muted-foreground' : 'text-destructive')} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs">{s.id}</div>
                        <div className={cn('text-xs', s.present ? 'text-muted-foreground' : 'text-destructive')}>
                          {s.fridge ? s.fridge.name : 'nieprzypisany'}{!s.present && ' · brak w statusie'}
                        </div>
                      </div>
                      <span className="tabular text-sm font-medium">{formatTemp(s.last_temp)} °C</span>
                      {!s.fridge && <IconAction label="Usuń czujnik" icon={Trash2} destructive onClick={() => removeSensor(s)} />}
                    </li>
                  ))}
                </ul>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
    </>
  );
}
