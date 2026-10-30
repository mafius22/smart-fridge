#ifndef MQTT_HANDLER_H
#define MQTT_HANDLER_H

#include <stdbool.h>
#include "offline_buffer.h"

// Inicjalizacja i połączenie z brokerem
bool mqtt_app_start(void);

// Rozłączenie i zwolnienie zasobów
void mqtt_app_stop(void);

// Funkcja do wysyłania pojedynczego pomiaru
bool mqtt_send_sensor_data(SensorData data);

// true po odebraniu komendy reset - restart wykonuje main
bool mqtt_restart_requested(void);

#endif // MQTT_HANDLER_H