import api from '../api/client';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getBrowserSubscription() {
  if (!pushSupported()) return null;
  // getRegistration zamiast ready - nie zawiesza sie, gdy service worker sie nie zarejestrowal
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Ta przeglądarka nie obsługuje powiadomień push');
  const { data } = await api.get('/push/vapid-key');
  if (!data.public_key) throw new Error('Serwer nie ma skonfigurowanych kluczy VAPID');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Brak zgody na powiadomienia w przeglądarce');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.public_key),
    });
  }
  await api.post('/push/subscriptions', sub.toJSON());
  return sub;
}

export async function disablePush() {
  const sub = await getBrowserSubscription();
  if (!sub) return;
  try {
    await api.delete('/push/subscriptions', { data: { endpoint: sub.endpoint } });
  } finally {
    await sub.unsubscribe();
  }
}

// Po zalogowaniu: istniejaca subskrypcja tej przegladarki trafia na konto (np. po odnowieniu przez przegladarke)
export async function syncPushSubscription() {
  try {
    const sub = await getBrowserSubscription();
    if (sub) await api.post('/push/subscriptions', sub.toJSON());
  } catch (e) {
    console.warn('Nie udało się zsynchronizować subskrypcji push', e);
  }
}
