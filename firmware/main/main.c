#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "driver/gpio.h"
#include "esp_event.h"
#include <sys/time.h>

// Biblioteki OneWire/DS18B20 (dla najnowszej wersji komponentu)
#include "onewire_bus.h"
#include "ds18b20.h"

// Twoje biblioteki
#include "storage_manager.h"
#include "offline_buffer.h"
#include "wifi_connect.h"
#include "ble_config.h"
#include "mqtt_handler.h"

static const char *TAG = "MAIN_SYSTEM";

// Konfiguracja
#define SENSOR_GPIO  GPIO_NUM_4
#define MAX_SENSORS  2

// Funkcja pobierająca pomiar (dostosowana do nowego API)
SensorData get_ds18b20_reading(ds18b20_device_handle_t sensor_handle) {
    SensorData d;
    
    // Ustawienie czasu
    struct timeval tv;
    gettimeofday(&tv, NULL);
    d.timestamp = (int64_t)tv.tv_sec;

    d.temp = -127.0; // Wartość błędu
    d.pressure = 0;  // DS18B20 nie mierzy ciśnienia

    if (sensor_handle == NULL) {
        ESP_LOGE(TAG, "Uchwyt czujnika jest NULL");
        return d;
    }

    // 1. Wyzwolenie pomiaru
    ESP_ERROR_CHECK(ds18b20_trigger_temperature_conversion(sensor_handle));
    
    // 2. Czekanie na konwersję (800ms jest bezpieczne dla 12-bit)
    vTaskDelay(pdMS_TO_TICKS(800));

    // 3. Odczyt temperatury
    float temperature;
    if (ds18b20_get_temperature(sensor_handle, &temperature) == ESP_OK) {
        d.temp = temperature;
    } else {
        ESP_LOGE(TAG, "Błąd odczytu temperatury (CRC lub Timeout)");
    }
    
    return d;
}

void app_main(void) {
    // 1. Inicjalizacja systemów bazowych
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
      ESP_ERROR_CHECK(nvs_flash_erase());
      ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    storage_init();
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    offline_buffer_init();
    ble_config_init(GPIO_NUM_0);
    wifi_connect_init();

    // 2. Inicjalizacja OneWire (Twoj nowy kod)
    onewire_bus_handle_t bus = NULL;
    onewire_bus_config_t bus_config = {
        .bus_gpio_num = SENSOR_GPIO,
        .flags = {
            .en_pull_up = true, // Włącza wewnętrzny pull-up (pomaga, mimo że masz zewnętrzny)
        }
    };
    
    // Konfiguracja RMT
    onewire_bus_rmt_config_t rmt_config = {
        .max_rx_bytes = 10, 
    };
    
    ESP_LOGI(TAG, "Inicjalizacja OneWire RMT na GPIO %d...", SENSOR_GPIO);
    ESP_ERROR_CHECK(onewire_new_bus_rmt(&bus_config, &rmt_config, &bus));

    // 3. Wyszukiwanie czujników (Twój nowy kod z pętlą)
    int ds18b20_device_num = 0;
    ds18b20_device_handle_t ds18b20s[MAX_SENSORS];
    onewire_device_iter_handle_t iter = NULL;
    onewire_device_t next_onewire_device;
    esp_err_t search_result = ESP_OK;

    ESP_ERROR_CHECK(onewire_new_device_iter(bus, &iter));
    ESP_LOGI(TAG, "Szukanie urządzeń...");

    do {
        search_result = onewire_device_iter_get_next(iter, &next_onewire_device);
        if (search_result == ESP_OK) { 
            // Znaleziono urządzenie 1-Wire, sprawdzamy czy to DS18B20
            ds18b20_config_t ds_cfg = {};
            
            // UWAGA: To jest funkcja z nowej wersji biblioteki:
            if (ds18b20_new_device_from_enumeration(&next_onewire_device, &ds_cfg, &ds18b20s[ds18b20_device_num]) == ESP_OK) {
                ESP_LOGI(TAG, "Znaleziono DS18B20 nr %d!", ds18b20_device_num);
                ds18b20_device_num++;
            } else {
                ESP_LOGI(TAG, "Znaleziono nieznane urządzenie 1-Wire (nie DS18B20).");
            }
        }
    } while (search_result != ESP_ERR_NOT_FOUND && ds18b20_device_num < MAX_SENSORS);
    
    ESP_ERROR_CHECK(onewire_del_device_iter(iter));
    ESP_LOGI(TAG, "Koniec szukania. Znaleziono łącznie: %d czujników.", ds18b20_device_num);

    // 4. Pętla Główna
    vTaskDelay(pdMS_TO_TICKS(1000));
    int cycle_counter = 0;

    while (1) {
        cycle_counter++;
        ESP_LOGI(TAG, "\n================ CYKL #%d ================", cycle_counter);

        // --- POMIAR ---
        SensorData current_data;
        
        // Jeśli znaleziono przynajmniej jeden czujnik, odczytaj pierwszy (indeks 0)
        if (ds18b20_device_num > 0) {
            current_data = get_ds18b20_reading(ds18b20s[0]);
            ESP_LOGI(TAG, "Odczyt: %.2f st. C", current_data.temp);
        } else {
            // Fallback - brak czujnika
            struct timeval tv;
            gettimeofday(&tv, NULL);
            current_data.timestamp = (int64_t)tv.tv_sec;
            current_data.temp = 0.0;
            current_data.pressure = 0;
            ESP_LOGW(TAG, "Brak podłączonego czujnika DS18B20!");
        }

        // --- WIFI & MQTT ---
        ESP_LOGI(TAG, "[WiFi] Łączenie...");
        if (wifi_connect_start() == ESP_OK) {
            ESP_LOGI(TAG, "[SYSTEM] ONLINE. Start MQTT...");
            
            if (mqtt_app_start()) {
                // Wysyłka bufora offline
                if (offline_buffer_count() > 0) {
                    ESP_LOGW(TAG, "Wysyłanie bufora...");
                    offline_process_queue(mqtt_send_sensor_data);
                }

                // Wysyłka bieżąca
                if (!mqtt_send_sensor_data(current_data)) {
                      ESP_LOGE(TAG, "Błąd wysyłki MQTT, zapis do bufora.");
                      offline_buffer_add(current_data);
                }
                
                mqtt_app_stop();
            } else {
                ESP_LOGE(TAG, "Błąd połączenia MQTT.");
                offline_buffer_add(current_data);
            }
        } else {
            ESP_LOGE(TAG, "Brak WiFi. Tryb offline.");
            offline_buffer_add(current_data);
        }

        wifi_connect_stop();

        ESP_LOGI(TAG, "[SLEEP] Czekam 10s...");
        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}