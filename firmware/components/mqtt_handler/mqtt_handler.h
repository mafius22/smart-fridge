#ifndef MQTT_HANDLER_H
#define MQTT_HANDLER_H

#include <stdbool.h>
#include "offline_buffer.h" // Potrzebujemy definicji SensorData

// Inicjalizacja i połączenie z brokerem (blokuje aż się połączy lub timeout)
bool mqtt_app_start(void);

// Rozłączenie i zwolnienie zasobów
void mqtt_app_stop(void);

// Funkcja do wysyłania pojedynczego pomiaru (blokuje aż wyśle)
bool mqtt_send_sensor_data(SensorData data);

#endif // MQTT_HANDLER_H