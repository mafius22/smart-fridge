#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "driver/gpio.h"
#include "esp_event.h"

#include "bmp180/bmp180.h"
#include "storage_manager.h"
#include "offline_buffer.h"
#include "wifi_connect.h"
#include "ble_config.h"
#include "mqtt_handler.h"

static const char *TAG = "MAIN_SYSTEM";

// Konfiguracja I2C
#define ESP_I2C_PORT I2C_NUM_0
#define ESP_I2C_SDA  GPIO_NUM_21
#define ESP_I2C_SCL  GPIO_NUM_22
#define DEVICE_I2C_ADDRESS 0 

// --- WRAPPER DLA BUFORA ---
// Funkcja offline_process_queue wymaga wskaźnika do funkcji, która przyjmuje SensorData i zwraca bool.
// Nasza mqtt_send_sensor_data pasuje idealnie, więc możemy jej użyć bezpośrednio!

SensorData get_bmp180_reading(bmp180_t *sensor_ctx) {
    SensorData d;
    d.timestamp = esp_timer_get_time() / 1000000;
    d.temp = 0.0;
    d.pressure = 0;

    if (sensor_ctx == NULL) return d;

    if (!bmp180_measure(sensor_ctx, &d.temp, &d.pressure)) {
        ESP_LOGE(TAG, "Błąd I2C BMP180");
    }
    return d;
}

void app_main(void) {
    storage_init();
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    offline_buffer_init();
    ble_config_init(GPIO_NUM_0);
    wifi_connect_init();

    // BMP180 Init
    i2c_lowlevel_config i2c_config = {0};
    i2c_config.port = ESP_I2C_PORT;
    i2c_config.pin_sda = ESP_I2C_SDA;
    i2c_config.pin_scl = ESP_I2C_SCL;
    bmp180_t *bmp_ctx = bmp180_init(&i2c_config, DEVICE_I2C_ADDRESS, BMP180_MODE_HIGH_RESOLUTION);

    if (bmp_ctx) ESP_LOGI(TAG, "BMP180 OK");

    vTaskDelay(pdMS_TO_TICKS(1000));
    int cycle_counter = 0;

    while (1) {
        cycle_counter++;
        ESP_LOGI(TAG, "\n================ CYKL #%d ================", cycle_counter);

        // 1. Pomiar
        SensorData current_data = get_bmp180_reading(bmp_ctx);
        ESP_LOGI(TAG, "Pomiar: %.2f C, %lu Pa", current_data.temp, current_data.pressure);

        // 2. WiFi
        ESP_LOGI(TAG, "[WiFi] Łączenie...");
        esp_err_t wifi_status = wifi_connect_start(); 

        if (wifi_status == ESP_OK) {
            ESP_LOGI(TAG, "[SYSTEM] ONLINE. Startuje MQTT...");
            
            // 3. Start MQTT (blokuje aż połączy)
            if (mqtt_app_start()) {
                
                // 4. Wysyłka zaległych (jeśli są)
                size_t buffered_count = offline_buffer_count();
                if (buffered_count > 0) {
                    ESP_LOGW(TAG, "[BUFFER] Wysyłanie %d zaległych...", buffered_count);
                    // Przekazujemy funkcję wysyłającą MQTT do procesora kolejki
                    offline_process_queue(mqtt_send_sensor_data);
                }

                // 5. Wysyłka bieżącego
                if (!mqtt_send_sensor_data(current_data)) {
                     ESP_LOGE(TAG, "Błąd wysyłki bieżącego pomiaru!");
                     offline_buffer_add(current_data); // Zapisz jeśli fail
                }

                // 6. Stop MQTT (ważne, zwalnia pamięć i zamyka socket)
                mqtt_app_stop();

            } else {
                ESP_LOGE(TAG, "MQTT Connection Failed. Przechodzę w tryb offline.");
                offline_buffer_add(current_data);
            }

        } else {
            ESP_LOGE(TAG, "[SYSTEM] OFFLINE. Zapis do Flash.");
            offline_buffer_add(current_data);
        }

        // 7. Stop WiFi
        wifi_connect_stop();

        ESP_LOGI(TAG, "[SLEEP] Czekam 10s...");
        vTaskDelay(pdMS_TO_TICKS(10000));
    }

    if (bmp_ctx) bmp180_free(bmp_ctx);
}