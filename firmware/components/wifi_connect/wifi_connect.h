#ifndef WIFI_CONNECT_H
#define WIFI_CONNECT_H

#include <stdbool.h>
#include "esp_err.h"

// 1. Inicjalizacja sterowników
void wifi_connect_init(void);

// 2. Włączenie radia i nawiązanie połączenia
esp_err_t wifi_connect_start(void);

// 3. Wyłączenie radia
void wifi_connect_stop(void);

// Sprawdza status
bool wifi_is_connected(void);

#endif // WIFI_CONNECT_H