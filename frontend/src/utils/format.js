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

export function thresholdsLabel(settings) {
  const { min_temp: min, max_temp: max } = settings || {};
  if (min == null && max == null) return 'brak progów';
  if (min != null && max != null) return `${min} … ${max} °C`;
  return min != null ? `min ${min} °C` : `max ${max} °C`;
}

export const STATE_LABELS = {
  ok: 'OK',
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

export function randomPassword(length = 12) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}
