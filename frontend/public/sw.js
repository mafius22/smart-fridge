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
      const jsonPayload = event.data.json();
      data = { ...data, ...jsonPayload };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png', 
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url,
      dateOfArrival: Date.now()
    },
    tag: 'smart-fridge-notification', 
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const targetUrl = notification.data.url || '/';

  notification.close(); 

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (let client of windowClients) {
          if (client.url.includes(targetUrl) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});