import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STATE_LABELS } from '@/utils/format';
import { STATE_TONE, TONE_BADGE } from '@/utils/status';

export default function StateBadge({ state, label, tone, className }) {
  const t = tone || STATE_TONE[state] || 'muted';
  return (
    <Badge variant="secondary" className={cn('gap-1.5 font-medium', TONE_BADGE[t], className)}>
      <span className={cn('size-1.5 rounded-full bg-current', t === 'alarm' || t === 'fault' ? 'animate-pulse' : '')} />
      {label || STATE_LABELS[state] || state}
    </Badge>
  );
}
