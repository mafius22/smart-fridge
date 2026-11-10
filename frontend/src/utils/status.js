// Kolory stanow lodowki i alarmow (klasy Tailwind z tokenow --ok, --warn, --alarm, --fault, --offline)
export const STATE_TONE = {
  ok: 'ok',
  pending: 'warn',
  alarm: 'alarm',
  fault: 'fault',
  offline: 'offline',
  no_sensor: 'muted',
  no_data: 'muted',
};

export const TONE_BADGE = {
  ok: 'bg-ok/12 text-ok',
  warn: 'bg-warn/15 text-warn',
  alarm: 'bg-alarm/12 text-alarm',
  fault: 'bg-fault/12 text-fault',
  offline: 'bg-offline/15 text-offline',
  muted: 'bg-muted text-muted-foreground',
};

export const TONE_ACCENT = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  alarm: 'bg-alarm',
  fault: 'bg-fault',
  offline: 'bg-offline',
  muted: 'bg-border',
};

export const TONE_PANEL = {
  ok: 'border-ok/30 bg-ok/8 text-ok',
  warn: 'border-warn/35 bg-warn/10 text-warn',
  alarm: 'border-alarm/30 bg-alarm/8 text-alarm',
  fault: 'border-fault/30 bg-fault/8 text-fault',
  offline: 'border-offline/30 bg-offline/10 text-offline',
  muted: 'border-border bg-muted text-muted-foreground',
};

export function alertTone(alert) {
  if (alert.is_fault) return alert.kind === 'offline' ? 'offline' : 'fault';
  return alert.pending ? 'warn' : 'alarm';
}

export const TONE_TEXT = {
  ok: 'text-ok',
  warn: 'text-warn',
  alarm: 'text-alarm',
  fault: 'text-fault',
  offline: 'text-offline',
  muted: 'text-muted-foreground',
};
