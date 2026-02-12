/* eslint-disable no-restricted-globals */

// 1. Obsługa otrzymywania powiadomień Push
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Otrzymano Pusha!');

  let data = { 
    title: 'Smart Fridge', 
    body: 'Masz nową wiadomość!',
    url: '/' 
  };

  if (event.data) {
    try {
      // Próba sparsowania JSON-a
      const jsonPayload = event.data.json();
      data = { ...data, ...jsonPayload };
    } catch (e) {
      // Jeśli to nie JSON, potraktuj to jako zwykły tekst
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    // iOS/Android lepiej radzą sobie z PNG niż SVG w powiadomieniach
    icon: '/icon-192.png', 
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url, // Przekazujemy URL do obsługi kliknięcia
      dateOfArrival: Date.now()
    },
    // To pozwala na grupowanie powiadomień (zamiast spamu jedno pod drugim)
    tag: 'smart-fridge-notification', 
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// 2. Obsługa kliknięcia w powiadomienie
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const targetUrl = notification.data.url || '/';

  notification.close(); // Zamknij powiadomienie

  // Sprytne otwieranie: jeśli apka jest otwarta, zrób focus. Jeśli nie, otwórz nową kartę.
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Sprawdź czy mamy już otwartą kartę z naszym adresem
        for (let client of windowClients) {
          if (client.url.includes(targetUrl) && 'focus' in client) {
            return client.focus();
          }
        }
        // Jeśli nie, otwórz nową
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});