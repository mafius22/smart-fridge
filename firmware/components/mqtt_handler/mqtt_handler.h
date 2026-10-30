#ifndef MQTT_HANDLER_H
#define MQTT_HANDLER_H

#include <stdbool.h>
#include "offline_buffer.h"

// Inicjalizacja i połączenie z brokerem
bool mqtt_app_start(void);

// Rozłączenie i zwolnienie zasobów
void mqtt_app_stop(void);

// Wysyla paczke pomiarow jedna wiadomoscia {"readings":[...]} i czeka na potwierdzenie (QoS1).
// Maks. OFFLINE_BATCH_MAX rekordow. true = broker potwierdzil odbior
bool mqtt_send_readings(const SensorData *items, size_t count);

// true po odebraniu komendy reset - restart wykonuje main
bool mqtt_restart_requested(void);

#endif // MQTT_HANDLER_H