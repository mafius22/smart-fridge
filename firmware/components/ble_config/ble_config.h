#ifndef BLE_CONFIG_H
#define BLE_CONFIG_H

#include <stdbool.h>
#include "esp_err.h"

// Konfiguracja pinu przycisku (zmień jeśli używasz innego niż BOOT button)
#define BLE_CONFIG_BUTTON_GPIO  0  

/**
 * @brief Inicjalizuje moduł konfiguracji (Button Task + Timer).
 * Sama obsługa BLE jest startowana dopiero po wciśnięciu przycisku.
 */
void ble_config_init(void);

/**
 * @brief Ręczne wymuszenie startu konfiguracji BLE (bez przycisku).
 */
void ble_config_start(void);

/**
 * @brief Zatrzymanie BLE i zwolnienie zasobów radia.
 */
void ble_config_stop(void);

#endif