import { format } from 'date-fns';

export function formatTemp(value) {
  return value === null || value === undefined ? '--.-' : Number(value).toFixed(1);
}

export function timeAgo(ts) {
  if (!ts) return 'brak danych';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return 'przed chwilą';
  if (s < 3600) return `${Math.floor(s / 60)} min temu`;
  if (s < 86400) return `${Math.floor(s / 3600)} h temu`;
  return `${Math.floor(s / 86400)} dni temu`;
}

// Polska odmiana: 1 lodowka, 2-4 lodowki, 5+ lodowek (12-14 tez "lodowek")
export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function formatTime(ts) {
  return ts ? format(new Date(ts * 1000), 'HH:mm') : '-';
}

export function formatDateTime(ts) {
  return ts ? format(new Date(ts * 1000), 'dd.MM.yyyy HH:mm') : '-';
}

export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} dni`;
}

// Jak dlugo trwa cos, co zaczelo sie o ts (np. aktywny alarm)
export function durationSince(ts) {
  return formatDuration(Math.max(0, Math.floor(Date.now() / 1000) - ts));
}

export function thresholdsLabel(settings) {
  const { min_temp: min, max_temp: max } = settings || {};
  if (min == null && max == null) return 'brak progów';
  if (min != null && max != null) return `${min} … ${max} °C`;
  return min != null ? `min ${min} °C` : `max ${max} °C`;
}

export const STATE_LABELS = {
  ok: 'OK',
  pending: 'Przekroczenie',
  alarm: 'Alarm',
  fault: 'Awaria',
  offline: 'Offline',
  no_sensor: 'Brak czujnika',
  no_data: 'Brak danych',
};

export const ALERT_LABELS = {
  high: 'Za wysoka temperatura',
  low: 'Za niska temperatura',
  sensor_error: 'Czujnik nie odpowiada (-127)',
  sensor_missing: 'Czujnik odłączony',
  offline: 'Płytka offline',
};

const END_REASON_LABELS = {
  prefs_changed: 'zmiana ustawień',
  access_removed: 'odebrany dostęp',
  sensor_changed: 'zmiana czujnika',
  fridge_disabled: 'strefa wyłączona',
  board_disabled: 'płytka wyłączona',
  user_blocked: 'konto zablokowane',
};

// Jak zakonczyl sie alarm - historia odroznia powrot do normy od zamkniecia przez zmiane ustawien
export function alertOutcome(alert) {
  if (alert.end_reason === 'outage') return 'w czasie przerwy w łączności (z bufora)';
  if (alert.end_reason === 'normal') return alert.notified_at ? 'wróciło do normy' : 'krótsze niż opóźnienie - bez powiadomienia';
  return END_REASON_LABELS[alert.end_reason] || '-';
}

export function randomPassword(length = 12) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}
