#ifndef OTA_HANDLER_H
#define OTA_HANDLER_H

#include "esp_err.h"

// Funkcja uruchamiająca aktualizację z podanego URL
// Blokuje działanie aż do restartu lub błędu
esp_err_t start_ota_update(const char *url);

#endif // OTA_HANDLER_H