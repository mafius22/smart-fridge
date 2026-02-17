#ifndef BLE_CONFIG_H
#define BLE_CONFIG_H

#include "driver/gpio.h"

// Inicjalizacja komponentu i start taska przycisku
void ble_config_init(gpio_num_t boot_btn_gpio);

// Ręczne zatrzymanie
void ble_config_stop(void);

#endif // BLE_CONFIG_H