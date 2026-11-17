import { Link } from 'react-router-dom';
import { Clock, Gauge } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import StateBadge from '@/components/StateBadge';
import { ALERT_LABELS, formatTemp, thresholdsLabel, timeAgo } from '@/utils/format';
import { STATE_TONE, TONE_ACCENT, TONE_BADGE, alertTone } from '@/utils/status';

export default function FridgeCard({ fridge }) {
  const tone = STATE_TONE[fridge.state] || 'muted';
  // Offline widac juz w odznace stanu - etykiety tylko dla alarmow, ktore cos dodaja (rodzaj alarmu, awarii)
  const chips = fridge.alerts.filter((a) => a.kind !== 'offline');

  return (
    <Card size="sm" className="relative gap-2 pl-1 transition-shadow hover:shadow-md has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring/50">
      {/* Pasek koloru stanu */}
      <span className={cn('absolute inset-y-0 left-0 w-1', TONE_ACCENT[tone])} aria-hidden />

      <div className="flex items-start justify-between gap-2 px-3">
        <div className="min-w-0">
          {/* Rozciagniety link: cala karta jest klikalna */}
          <Link
            to={`/fridges/${fridge.id}`}
            className="block truncate text-sm font-semibold outline-none after:absolute after:inset-0 after:content-['']"
          >
            {fridge.display_name}
          </Link>
          {fridge.location && <p className="truncate text-xs text-muted-foreground">{fridge.location}</p>}
        </div>
        <StateBadge state={fridge.state} />
      </div>

      <div className="px-3">
        <div className={cn('tabular text-3xl font-semibold tracking-tight', fridge.last_temp == null && 'text-muted-foreground')}>
          {formatTemp(fridge.last_temp)}
          <span className="ml-0.5 align-top text-base font-normal text-muted-foreground">°C</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Clock className="size-3" />{timeAgo(fridge.last_ts)}</span>
          <span className="flex items-center gap-1"><Gauge className="size-3" />{thresholdsLabel(fridge.settings)}</span>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3">
          {chips.map((a) => (
            <Badge key={a.id} variant="secondary" className={cn('h-auto whitespace-normal', TONE_BADGE[alertTone(a)])}>
              {a.recovers_at ? 'Czujnik znów odpowiada' : ALERT_LABELS[a.kind]}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}
