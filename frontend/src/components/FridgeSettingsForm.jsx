import { useId, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import Field from '@/components/Field';
import FormMessage from '@/components/FormMessage';

const toInput = (v) => (v === null || v === undefined ? '' : String(v));
const MAX_DELAY_MIN = 240;

function parseTemp(value) {
  const normalized = value.trim().replace(',', '.');
  if (normalized === '') return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

// Folder ustawia sie na pulpicie (panel Foldery) - formularz go nie wysyla, wiec przypisanie zostaje bez zmian
export default function FridgeSettingsForm({ fridge, onSaved }) {
  const [form, setForm] = useState(() => ({
    custom_name: fridge.custom_name || '',
    min_temp: toInput(fridge.settings.min_temp),
    max_temp: toInput(fridge.settings.max_temp),
    notify_low: fridge.settings.notify_low,
    notify_high: fridge.settings.notify_high,
    notify_fault: fridge.settings.notify_fault,
    alert_delay_min: String(fridge.settings.alert_delay_min ?? 0),
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDelayHelp, setShowDelayHelp] = useState(false);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const onInput = (key) => (e) => set(key, e.target.value);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const min = parseTemp(form.min_temp);
    const max = parseTemp(form.max_temp);
    if (Number.isNaN(min) || Number.isNaN(max)) return setError('Progi muszą być liczbami');
    if (min !== null && max !== null && min >= max) return setError('Próg minimalny musi być niższy od maksymalnego');
    const delay = form.alert_delay_min.trim() === '' ? 0 : Number(form.alert_delay_min);
    if (!Number.isInteger(delay) || delay < 0 || delay > MAX_DELAY_MIN) {
      return setError(`Opóźnienie musi być liczbą minut od 0 do ${MAX_DELAY_MIN}`);
    }

    setBusy(true);
    try {
      const res = await api.patch(`/fridges/${fridge.id}/prefs`, {
        custom_name: form.custom_name.trim() || null,
        min_temp: min,
        max_temp: max,
        notify_low: form.notify_low,
        notify_high: form.notify_high,
        notify_fault: form.notify_fault,
        alert_delay_min: delay,
      });
      toast.success('Zapisano ustawienia');
      onSaved?.(res.data.fridge);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <Section title="Nazwa">
        <Input
          value={form.custom_name}
          maxLength={100}
          placeholder={fridge.name}
          aria-label="Moja nazwa"
          onChange={onInput('custom_name')}
          className="max-w-sm"
        />
      </Section>

      <Separator />

      <Section title="Progi" description="Puste pole = bez progu.">
        <div className="grid max-w-xl grid-cols-3 items-end gap-3">
          <Field label="Min °C">
            <Input inputMode="decimal" value={form.min_temp} placeholder="brak" onChange={onInput('min_temp')} />
          </Field>
          <Field label="Max °C">
            <Input inputMode="decimal" value={form.max_temp} placeholder="brak" onChange={onInput('max_temp')} />
          </Field>
          <Field label="Opóźnienie (min)">
            <Input type="number" min={0} max={MAX_DELAY_MIN} step={1} value={form.alert_delay_min} onChange={onInput('alert_delay_min')} />
          </Field>
        </div>
        <div className="max-w-xl text-xs text-muted-foreground">
          <p>
            Opóźnienie - jak długo temperatura musi być poza progiem, zanim przyjdzie powiadomienie (0 = od razu).{' '}
            <button
              type="button"
              className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
              aria-expanded={showDelayHelp}
              onClick={() => setShowDelayHelp((v) => !v)}
            >
              Jak to działa?
              <ChevronDown className={cn('size-3.5 transition-transform', showDelayHelp && 'rotate-180')} />
            </button>
          </p>
          {showDelayHelp && (
            <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2">
              Przy opóźnieniu 30 min i progu max 8 °C powiadomienie przyjdzie dopiero wtedy, gdy temperatura będzie
              powyżej 8 °C przez 30 minut bez przerwy. Krótsze skoki - otwarte drzwi, rozładunek, odszranianie -
              zobaczysz tylko w aplikacji jako żółte „Przekroczenie”.
            </p>
          )}
        </div>
      </Section>

      <Separator />

      <Section title="Powiadomienia" description="Raz przy przekroczeniu i raz po powrocie do normy.">
        <div className="grid gap-2 sm:grid-cols-3">
          <ToggleBox label="Za niska" description="poniżej min"
            checked={form.notify_low} onCheckedChange={(v) => set('notify_low', v)} />
          <ToggleBox label="Za wysoka" description="powyżej max"
            checked={form.notify_high} onCheckedChange={(v) => set('notify_high', v)} />
          <ToggleBox label="Awarie" description="offline, czujnik - od razu"
            checked={form.notify_fault} onCheckedChange={(v) => set('notify_fault', v)} />
        </div>
      </Section>

      <FormMessage message={error ? { type: 'error', text: error } : null} />
      <div className="flex justify-end">
        <Button type="submit" disabled={busy} className="w-full sm:w-fit">
          {busy && <Loader2 className="animate-spin" />}
          Zapisz ustawienia
        </Button>
      </div>
    </form>
  );
}

// Sekcja ustawien: tytul (i krotki opis) po lewej, pola po prawej; na telefonie tytul nad polami
function Section({ title, description, children }) {
  return (
    <section className="grid gap-3 md:grid-cols-[minmax(0,12rem)_1fr] md:gap-8">
      <div className="grid content-start gap-0.5 md:pt-1.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="grid content-start gap-2.5">{children}</div>
    </section>
  );
}

// Przelacznik w ramce - cala ramka klikalna
function ToggleBox({ label, description, checked, onCheckedChange }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/40"
    >
      <span className="grid">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
