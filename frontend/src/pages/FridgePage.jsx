import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ChevronRight, ChevronLeft, AlertTriangle, ArrowLeft, ChartLine, Clock, History, MapPin, Maximize2, Minimize2, SlidersHorizontal,
  Thermometer, WifiOff,
} from 'lucide-react';
import api, { apiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import FridgeSettingsForm from '@/components/FridgeSettingsForm';
import PageLoading from '@/components/PageLoading';
import StateBadge from '@/components/StateBadge';
import TemperatureChart from '@/components/TemperatureChart';
import { orderedFridges } from '@/utils/order';
import usePolling from '@/utils/usePolling';
import {
  ALERT_LABELS, alertOutcome, durationSince, formatDateTime, formatDuration, formatTemp, formatTime, timeAgo,
} from '@/utils/format';
import { STATE_TONE, TONE_ACCENT, TONE_PANEL, TONE_TEXT, alertTone } from '@/utils/status';

const TABS = ['chart', 'history', 'settings'];

const RANGES = [
  { key: '24h', label: '24 h', seconds: 86400 },
  { key: '7d', label: '7 dni', seconds: 7 * 86400 },
  { key: '30d', label: '30 dni', seconds: 30 * 86400 },
];
const toLocalInput = (ts) => format(new Date(ts * 1000), "yyyy-MM-dd'T'HH:mm");
const fromLocalInput = (value) => Math.floor(new Date(value).getTime() / 1000);

function ActiveAlert({ alert, delayMin }) {
  const tone = alertTone(alert);
  const Icon = alert.kind === 'offline' ? WifiOff : AlertTriangle;
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3', TONE_PANEL[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="text-sm">
        {alert.recovers_at ? (
          <>
            <span className="font-semibold">Czujnik znów odpowiada</span>
            <span className="text-foreground/80"> - awaria zamknie się ok. {formatTime(alert.recovers_at)}, jeśli do tego czasu nie będzie -127</span>
          </>
        ) : (
          <>
            <span className="font-semibold">{ALERT_LABELS[alert.kind]}</span>
            <span className="text-foreground/80">
              {alert.value != null && ` (${alert.value.toFixed(1)} °C)`} od {formatDateTime(alert.started_at)}
              {` · trwa ${durationSince(alert.started_at)}`}
              {alert.pending && ` - powiadomienie, jeśli potrwa dłużej niż ${delayMin} min`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// Strzalka do sasiedniej strefy; podpowiedz z nazwa strefy, do ktorej prowadzi
function ZoneArrow({ direction, target, onClick }) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
  const label = target
    ? `${direction === 'prev' ? 'Poprzednia' : 'Następna'} strefa: ${target.name}`
    : (direction === 'prev' ? 'Poprzednia strefa' : 'Następna strefa');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          className="shrink-0 rounded-full text-muted-foreground"
          disabled={!target}
          onClick={onClick}
          aria-label={label}
        >
          <Icon className="size-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}{target && ' (klawisz ' + (direction === 'prev' ? '←' : '→') + ')'}</TooltipContent>
    </Tooltip>
  );
}

export default function FridgePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Kolejnosc stref jak na pulpicie - do strzalek poprzednia / nastepna
  const [order, setOrder] = useState([]);
  // Wybrana zakladka w adresie (?tab=history) - zostaje po odswiezeniu strony
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'chart';
  const setTab = (value) => setSearchParams(value === 'chart' ? {} : { tab: value }, { replace: true });
  const [fridge, setFridge] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState('');

  const [rangeKey, setRangeKey] = useState('24h');
  const [custom, setCustom] = useState(() => {
    const now = Math.floor(Date.now() / 1000);
    return { start: toLocalInput(now - 86400), end: toLocalInput(now) };
  });
  const [history, setHistory] = useState(null);
  // Wykres na caly ekran: Fullscreen API (komputer, Android); na iPhonie karta przykrywa cale okno
  const chartCardRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  // Szczegoly alarmu z historii (na telefonie tabela pokazuje tylko rodzaj i zakonczenie)
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadFridge = useCallback(async () => {
    try {
      const [f, a] = await Promise.all([api.get(`/fridges/${id}`), api.get(`/fridges/${id}/alerts`)]);
      setFridge(f.data.fridge);
      setAlerts(a.data.alerts);
      setError('');
    } catch (err) {
      setError(apiError(err, 'Nie udało się pobrać strefy'));
    }
  }, [id]);

  usePolling(loadFridge, 30000, [id]);

  // Szerokosc wykresu w px (bez osi): backend wysyla najwyzej 2 pomiary na piksel. Zaokraglona do 100 px
  const chartWidth = () => {
    const box = chartCardRef.current?.clientWidth || window.innerWidth;
    return Math.min(4000, Math.max(100, Math.ceil((box - 60) / 100) * 100));
  };

  const loadHistory = useCallback(async () => {
    let start;
    let end;
    if (rangeKey === 'custom') {
      start = fromLocalInput(custom.start);
      end = fromLocalInput(custom.end);
      if (!(start < end)) return setError('Początek zakresu musi być przed końcem');
    } else {
      end = Math.floor(Date.now() / 1000);
      start = end - RANGES.find((r) => r.key === rangeKey).seconds;
    }
    setLoadingHistory(true);
    try {
      const res = await api.get(`/fridges/${id}/measurements`, { params: { from: start, to: end, width: chartWidth() } });
      setHistory(res.data);
      setError('');
    } catch (err) {
      setError(apiError(err, 'Nie udało się pobrać pomiarów'));
    } finally {
      setLoadingHistory(false);
    }
  }, [id, rangeKey, custom]);

  useEffect(() => {
    if (rangeKey !== 'custom') loadHistory();
    // Zakres wlasny laduje sie dopiero po kliknieciu "Pokaz"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rangeKey]);

  // Pelny ekran zmienia szerokosc wykresu - pobranie punktow dla nowej szerokosci, gdy przegladarka
  // skonczy przejscie (wejscie/wyjscie z fullscreen). Porownanie z poprzednia wartoscia, nie "pierwsze uruchomienie"
  const prevExpanded = useRef(expanded);
  useEffect(() => {
    if (prevExpanded.current === expanded) return undefined;
    prevExpanded.current = expanded;
    const timer = setTimeout(loadHistory, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return undefined;
    // Wyjscie z pelnego ekranu przez przegladarke (Esc, gest wstecz) albo Esc w widoku zapasowym
    const onFullscreenChange = () => { if (!document.fullscreenElement) setExpanded(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setExpanded(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  const toggleExpanded = async () => {
    if (expanded) {
      setExpanded(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      return;
    }
    setExpanded(true);
    try {
      await chartCardRef.current?.requestFullscreen?.();
      // Telefon poziomo - tylko w trybie pelnoekranowym (Android); gdzie nie dziala, zostaje pion
      await window.screen.orientation?.lock?.('landscape');
    } catch {
      // Brak Fullscreen API (iPhone) albo blokady obrotu - zostaje widok na cale okno
    }
  };

  useEffect(() => {
    Promise.all([api.get('/fridges'), api.get('/folders')])
      .then(([f, d]) => setOrder(orderedFridges(f.data.fridges, d.data.folders).map((x) => ({ id: x.id, name: x.display_name }))))
      .catch(() => {});
  }, []);

  // Sasiednie strefy (w kolko: za ostatnia jest pierwsza); zakladka (?tab=) zostaje
  const index = order.findIndex((f) => String(f.id) === String(id));
  const prev = order.length > 1 && index >= 0 ? order[(index - 1 + order.length) % order.length] : null;
  const next = order.length > 1 && index >= 0 ? order[(index + 1) % order.length] : null;
  const goTo = useCallback((target) => {
    if (target) navigate({ pathname: `/fridges/${target.id}`, search: searchParams.toString() });
  }, [navigate, searchParams]);

  // Klawisze strzalek - poza polami formularza i bez otwartego okna / pelnego ekranu
  useEffect(() => {
    const onKey = (e) => {
      if (expanded || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = document.activeElement;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.getAttribute('role') === 'tab')) return;
      if (document.querySelector('[role=dialog]')) return;
      if (e.key === 'ArrowLeft') goTo(prev);
      if (e.key === 'ArrowRight') goTo(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, goTo, expanded]);

  if (!fridge) return <PageLoading error={error} />;

  const pastAlerts = alerts.filter((a) => a.ended_at);
  const tone = STATE_TONE[fridge.state] || 'muted';

  // Komputer (lg): strona ma wysokosc okna (100svh - pasek 3.5rem z ramka 1px - odstepy 3rem), a wykres / historia zajmuja
  // cale pozostale miejsce (flex) - bez paska przewijania strony. Ustawienia i telefon: zwykle przewijanie
  const fill = tab !== 'settings';

  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-6', fill && 'lg:flex lg:h-[calc(100svh-6.5rem-1px)] lg:flex-col')}>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit shrink-0 text-muted-foreground">
        <Link to="/"><ArrowLeft /> Strefy</Link>
      </Button>

      {/* Naglowek: nazwa, stan, temperatura. Stan plytki widac w odznace i w alarmie ponizej - bez powtarzania */}
      <Card className="shrink-0">
        <CardContent className="flex items-center gap-2 sm:gap-4">
          <ZoneArrow direction="prev" target={prev} onClick={() => goTo(prev)} />
          <div className="grid min-w-0 flex-1 gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{fridge.display_name}</h1>
              <StateBadge state={fridge.state} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {fridge.custom_name && <span>{fridge.name}</span>}
              {fridge.location && (
                <span className="flex items-center gap-1"><MapPin className="size-3.5" />{fridge.location}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 sm:justify-end">
            <Thermometer className={cn('size-9', tone === 'ok' ? 'text-primary' : TONE_TEXT[tone])} />
            <div>
              <div className="tabular text-5xl font-semibold tracking-tight">
                {formatTemp(fridge.last_temp)}
                <span className="ml-1 align-top text-xl font-normal text-muted-foreground">°C</span>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3.5" />{timeAgo(fridge.last_ts)}
              </div>
            </div>
          </div>
          </div>
          <ZoneArrow direction="next" target={next} onClick={() => goTo(next)} />
        </CardContent>
      </Card>

      {error && <p className="shrink-0 text-sm text-destructive">{error}</p>}

      {fridge.alerts.length > 0 && (
        <div className="grid shrink-0 gap-2">
          {fridge.alerts.map((a) => <ActiveAlert key={a.id} alert={a} delayMin={fridge.settings.alert_delay_min} />)}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="gap-4 lg:min-h-0 lg:flex-1">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="chart" className="px-2 sm:px-3 max-[399px]:[&>svg]:hidden"><ChartLine /> Temperatura</TabsTrigger>
          <TabsTrigger value="history" className="px-2 sm:px-3 max-[399px]:[&>svg]:hidden">
            <History /> Historia
          </TabsTrigger>
          <TabsTrigger value="settings" className="px-2 sm:px-3 max-[399px]:[&>svg]:hidden"><SlidersHorizontal /> Ustawienia</TabsTrigger>
        </TabsList>

        <TabsContent value="chart" className="lg:flex lg:min-h-0 lg:flex-col">
          <Card
            ref={chartCardRef}
            className={cn('lg:min-h-0 lg:flex-1', expanded && 'fixed inset-0 z-50 rounded-none ring-0')}
          >
            <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <Tabs value={rangeKey} onValueChange={setRangeKey}>
                  <TabsList>
                    {RANGES.map((r) => <TabsTrigger key={r.key} value={r.key} className="px-2 sm:px-3">{r.label}</TabsTrigger>)}
                    <TabsTrigger value="custom" className="px-2 sm:px-3">Własny</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={toggleExpanded}
                  aria-label={expanded ? 'Zamknij pełny ekran' : 'Pełny ekran'}
                  title={expanded ? 'Zamknij pełny ekran (Esc)' : 'Pełny ekran'}
                >
                  {expanded ? <Minimize2 /> : <Maximize2 />}
                </Button>
              </div>

              {rangeKey === 'custom' && (
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="datetime-local" className="w-auto" value={custom.start} aria-label="Od"
                    onChange={(e) => setCustom({ ...custom, start: e.target.value })} />
                  <span className="text-muted-foreground">–</span>
                  <Input type="datetime-local" className="w-auto" value={custom.end} aria-label="Do"
                    onChange={(e) => setCustom({ ...custom, end: e.target.value })} />
                  <Button variant="secondary" onClick={loadHistory}>Pokaż</Button>
                </div>
              )}

              {/* Telefon: stala wysokosc; komputer i pelny ekran: cale wolne miejsce w karcie (min. 240 px) */}
              <div className={cn('flex w-full flex-col', expanded ? 'min-h-0 flex-1' : 'lg:min-h-60 lg:flex-1')}>
                {history ? (
                  <TemperatureChart
                    points={history.points}
                    bucketS={history.bucket_s}
                    start={history.start}
                    end={history.end}
                    minTemp={fridge.settings.min_temp}
                    maxTemp={fridge.settings.max_temp}
                    className={cn(
                      expanded ? 'min-h-0 flex-1' : 'h-72 sm:h-80 lg:h-auto lg:min-h-0 lg:flex-1',
                      loadingHistory && 'opacity-50 transition-opacity',
                    )}
                  />
                ) : (
                  <Skeleton className={cn('w-full', expanded ? 'flex-1' : 'h-72 sm:h-80 lg:h-auto lg:flex-1')} />
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Karta historii rosnie z liczba wierszy do wysokosci okna, dalej przewija sie sama tabela */}
        <TabsContent value="history" className="lg:flex lg:min-h-0 lg:flex-col">
          <Card className="lg:max-h-full lg:min-h-0">
            <CardContent className="lg:flex lg:min-h-0 lg:flex-col">
              {pastAlerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Brak zakończonych alarmów.</p>
              ) : (
                <Table containerClassName="max-h-[60svh] overflow-y-auto lg:max-h-none lg:min-h-0">
                  {/* Naglowek kolumn zostaje widoczny przy przewijaniu historii */}
                  {/* Telefon: Rodzaj (z data) + Zakonczenie; reszta w oknie po kliknieciu w wiersz */}
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>Rodzaj</TableHead>
                      <TableHead className="hidden md:table-cell">Początek</TableHead>
                      <TableHead className="hidden md:table-cell">Czas trwania</TableHead>
                      <TableHead className="hidden md:table-cell">Wartość</TableHead>
                      <TableHead>Zakończenie</TableHead>
                      <TableHead className="w-6 md:hidden" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pastAlerts.map((a) => (
                      <TableRow
                        key={a.id}
                        tabIndex={0}
                        className="cursor-pointer"
                        onClick={() => setSelectedAlert(a)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setSelectedAlert(a); }}
                      >
                        <TableCell className="whitespace-normal">
                          <span className="flex items-center gap-2">
                            <span className={cn('size-2 shrink-0 rounded-full', TONE_ACCENT[alertTone(a)])} />
                            {ALERT_LABELS[a.kind]}
                          </span>
                          <span className="tabular block pl-4 text-xs text-muted-foreground md:hidden">{formatDateTime(a.started_at)}</span>
                        </TableCell>
                        <TableCell className="tabular hidden md:table-cell">{formatDateTime(a.started_at)}</TableCell>
                        <TableCell className="tabular hidden md:table-cell">{formatDuration(a.ended_at - a.started_at)}</TableCell>
                        <TableCell className="tabular hidden md:table-cell">
                          {a.value != null ? `${a.value.toFixed(1)} °C` : '-'}
                          {a.threshold != null && <span className="text-xs text-muted-foreground"> (próg {a.threshold} °C)</span>}
                        </TableCell>
                        <TableCell className="whitespace-normal text-xs text-muted-foreground">{alertOutcome(a)}</TableCell>
                        <TableCell className="text-muted-foreground md:hidden"><ChevronRight className="size-4" /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardContent>
              <FridgeSettingsForm key={fridge.id} fridge={fridge} onSaved={(f) => setFridge(f)} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(selectedAlert)} onOpenChange={(o) => { if (!o) setSelectedAlert(null); }}>
        <DialogContent className="sm:max-w-sm">
          {selectedAlert && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className={cn('size-2.5 shrink-0 rounded-full', TONE_ACCENT[alertTone(selectedAlert)])} />
                  {ALERT_LABELS[selectedAlert.kind]}
                </DialogTitle>
                <DialogDescription>{fridge.display_name}</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
                <dt className="text-muted-foreground">Początek</dt>
                <dd className="tabular">{formatDateTime(selectedAlert.started_at)}</dd>
                <dt className="text-muted-foreground">Koniec</dt>
                <dd className="tabular">{formatDateTime(selectedAlert.ended_at)}</dd>
                <dt className="text-muted-foreground">Czas trwania</dt>
                <dd className="tabular">{formatDuration(selectedAlert.ended_at - selectedAlert.started_at)}</dd>
                {selectedAlert.value != null && (
                  <>
                    <dt className="text-muted-foreground">Wartość</dt>
                    <dd className="tabular">{selectedAlert.value.toFixed(1)} °C</dd>
                  </>
                )}
                {selectedAlert.threshold != null && (
                  <>
                    <dt className="text-muted-foreground">Próg</dt>
                    <dd className="tabular">{selectedAlert.threshold} °C</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Zakończenie</dt>
                <dd>{alertOutcome(selectedAlert)}</dd>
              </dl>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
