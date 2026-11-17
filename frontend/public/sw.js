// Powiadomienia push z backendu: {title, body, url, tag}

self.addEventListener('push', (event) => {
  let data = { title: 'Smart Fridge', body: 'Nowe powiadomienie', url: '/' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/', dateOfArrival: Date.now() },
    // Ten sam tag (lodowka + rodzaj alarmu): "OK" zastepuje wczesniejszy "ALARM" zamiast dokladac kolejne
    tag: data.tag || 'smart-fridge',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client && 'navigate' in client) {
          return client.navigate(targetUrl).then((c) => (c || client).focus());
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    }),
  );
});
