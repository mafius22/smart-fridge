#ifndef MQTT_HANDLER_H
#define MQTT_HANDLER_H

#include <stdbool.h>
#include "offline_buffer.h"

// true = w NVS jest zapisany adres brokera (skonfigurowany przez BLE)
bool mqtt_has_config(void);

// Inicjalizacja i połączenie z brokerem (dane z NVS); false = brak konfiguracji albo brak polaczenia
bool mqtt_app_start(void);

// Rozłączenie i zwolnienie zasobów
void mqtt_app_stop(void);

// Wysyla paczke pomiarow jedna wiadomoscia {"readings":[...]} i czeka na potwierdzenie (QoS1).
// Maks. OFFLINE_BATCH_MAX rekordow. true = broker potwierdzil odbior
bool mqtt_send_readings(const SensorData *items, size_t count);

// Publikuje stan plytki (JSON) na sf/v1/{id}/status jako retained, czeka na potwierdzenie
bool mqtt_publish_status(const char *json);

// true po odebraniu komendy reset - restart wykonuje main
bool mqtt_restart_requested(void);

#endif // MQTT_HANDLER_H