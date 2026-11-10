import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Bell, BellOff, ChevronRight, History, KeyRound, Send, Smartphone, UserRound,
} from 'lucide-react';
import api, { apiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import Field from '@/components/Field';
import PageHeader from '@/components/PageHeader';
import StateBadge from '@/components/StateBadge';
import SwitchRow from '@/components/SwitchRow';
import { disablePush, enablePush, getBrowserSubscription, pushSupported } from '@/utils/push';

function MenuItem({ icon: Icon, title, value, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4.5" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-sm font-medium">{title}</span>
        {value && <span className="truncate text-xs text-muted-foreground">{value}</span>}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function Panel({ open, onOpenChange, title, description, children }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] gap-5 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function NameForm({ user, onSave }) {
  const [name, setName] = useState(user.display_name || '');
  const unchanged = (name.trim() || null) === (user.display_name || null);
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); onSave(name.trim() || null); }}>
      <Field label="Nazwa wyświetlana">
        <Input value={name} maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
      <Button type="submit" disabled={unchanged}>Zapisz</Button>
    </form>
  );
}

function DevicePush() {
  const [subscribed, setSubscribed] = useState(null); // null = sprawdzam
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();

  const refresh = () => getBrowserSubscription().then((sub) => setSubscribed(Boolean(sub))).catch(() => setSubscribed(false));
  useEffect(() => { refresh(); }, []);

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okText);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"><Smartphone className="size-4" /></span>
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            To urządzenie
            {supported && subscribed === true && <StateBadge tone="ok" label="włączone" />}
            {supported && subscribed === false && <StateBadge tone="muted" label="wyłączone" />}
          </div>
          <p className="text-xs text-muted-foreground">
            {supported
              ? 'Powiadomienia push w tej przeglądarce / na tym telefonie.'
              : 'Przeglądarka nie obsługuje powiadomień push (na iPhone: dodaj aplikację do ekranu początkowego).'}
          </p>
        </div>
      </div>
      {supported && (
        <div className="flex flex-wrap gap-2">
          {subscribed ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => run(() => api.post('/push/test'), 'Wysłano powiadomienie testowe')}>
                <Send /> Test
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => run(disablePush, 'Wyłączono powiadomienia na tym urządzeniu')}>
                <BellOff /> Wyłącz na tym urządzeniu
              </Button>
            </>
          ) : (
            <Button disabled={busy || subscribed === null} onClick={() => run(enablePush, 'Włączono powiadomienia na tym urządzeniu')}>
              <Bell /> Włącz na tym urządzeniu
            </Button>
          )}
        </div>
      )}
      {supported && subscribed && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Nie widzisz powiadomienia? Na komputerze sprawdź, czy system nie blokuje powiadomień z przeglądarki.
        </p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const [panel, setPanel] = useState(null); // 'name' | 'password' | 'notifications' | 'history'

  const saveProfile = async (patch, okText = 'Zapisano') => {
    try {
      const res = await api.patch('/auth/me', patch);
      setUser(res.data.user);
      toast.success(okText);
      return true;
    } catch (err) {
      toast.error(apiError(err));
      return false;
    }
  };

  const panelProps = (key) => ({ open: panel === key, onOpenChange: (o) => setPanel(o ? key : null) });

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageHeader title="Ustawienia" />

      <Card className="gap-0 py-0">
        <MenuItem icon={UserRound} title="Nazwa użytkownika" value={user.display_name || 'nie ustawiono'} onClick={() => setPanel('name')} />
        <Separator />
        <MenuItem icon={KeyRound} title="Zmień hasło" value="Inne urządzenia zostaną wylogowane" onClick={() => setPanel('password')} />
        <Separator />
        <MenuItem
          icon={Bell}
          title="Powiadomienia"
          value={user.notifications_enabled ? 'Włączone' : 'Wstrzymane'}
          onClick={() => setPanel('notifications')}
        />
        <Separator />
        <MenuItem
          icon={History}
          title="Historia stref"
          value={user.show_short_alerts ? 'Pokazuje krótkie przekroczenia' : 'Tylko alarmy z powiadomieniem'}
          onClick={() => setPanel('history')}
        />
      </Card>

      <Panel {...panelProps('name')} title="Nazwa użytkownika" description="Widać ją w menu i w panelu administratora.">
        {panel === 'name' && (
          <NameForm user={user} onSave={async (name) => { if (await saveProfile({ display_name: name })) setPanel(null); }} />
        )}
      </Panel>

      <Panel {...panelProps('password')} title="Zmień hasło" description="Po zmianie inne urządzenia zostaną wylogowane.">
        {panel === 'password' && (
          <ChangePasswordForm onDone={() => { setPanel(null); toast.success('Hasło zmienione. Inne urządzenia zostały wylogowane.'); }} />
        )}
      </Panel>

      <Panel {...panelProps('notifications')} title="Powiadomienia" description="Progi i rodzaje alarmów ustawiasz osobno dla każdej strefy na jej stronie.">
        <SwitchRow
          label="Wysyłaj mi powiadomienia"
          description="Wyłączenie wstrzymuje wszystkie powiadomienia na wszystkich urządzeniach. Alarmy nadal są zapisywane."
          checked={user.notifications_enabled}
          onCheckedChange={(v) => saveProfile({ notifications_enabled: v })}
        />
        <Separator />
        {panel === 'notifications' && <DevicePush />}
      </Panel>

      <Panel {...panelProps('history')} title="Historia stref">
        <SwitchRow
          label="Pokazuj krótkie przekroczenia"
          description="Przekroczenia krótsze niż ustawione opóźnienie (bez powiadomienia) w historii alarmów każdej strefy."
          checked={Boolean(user.show_short_alerts)}
          onCheckedChange={(v) => saveProfile({ show_short_alerts: v })}
        />
      </Panel>
    </div>
  );
}
