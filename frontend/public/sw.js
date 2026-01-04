// frontend/public/sw.js

self.addEventListener('push', function(event) {
    console.log('[Service Worker] Otrzymano Pusha!');
  
    // Jeśli backend przysłał dane, użyj ich. Jeśli nie - tekst domyślny.
    let data = { title: 'Smart Fridge', body: 'Nowe powiadomienie!' };
    
    if (event.data) {
      try {
        data = event.data.json();
      } catch (e) {
        data = { ...data, body: event.data.text() };
      }
    }
  
    const options = {
      body: data.body,
      icon: '/vite.svg', // Ikonka (możesz wrzucić plik icon.png do public)
      badge: '/vite.svg',
      vibrate: [100, 50, 100], // Wibracja telefonu
      data: {
        dateOfArrival: Date.now(),
        primaryKey: 1
      }
    };
  
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  });
  
  // Obsługa kliknięcia w powiadomienie
  self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
      clients.openWindow('/') // Otwórz aplikację po kliknięciu
    );
  });