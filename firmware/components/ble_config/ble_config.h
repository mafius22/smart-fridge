#ifndef BLE_CONFIG_H
#define BLE_CONFIG_H

#include <stdbool.h>
#include "driver/gpio.h"

// Wywolywane po przytrzymaniu przycisku 10 s i puszczeniu - czysci dane i restartuje plytke
typedef void (*factory_reset_cb_t)(void);

// Inicjalizacja komponentu i start taska przycisku.
// start_now = true: BLE od razu i bez limitu czasu (brak zapisanej sieci Wi-Fi)
void ble_config_init(gpio_num_t boot_btn_gpio, bool start_now, factory_reset_cb_t factory_reset_cb);

// Ręczne zatrzymanie
void ble_config_stop(void);

#endif // BLE_CONFIG_H
