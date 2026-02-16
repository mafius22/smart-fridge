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
#include <time.h>           // Do obsługi struktur czasu
#include "esp_sntp.h"       // Do synchronizacji czasu z Internetem

// Biblioteki OneWire/DS18B20
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
#define MAX_SENSORS  10          // Limit liczby czujników

// --- FUNKCJA DO POBIERANIA CZASU (SNTP) ---
static void obtain_time(void) {
    // 1. Sprawdź czy czas jest już ustawiony
    time_t now;
    struct tm timeinfo;
    time(&now);
    localtime_r(&now, &timeinfo);

    // Jeśli rok > 2020, to znaczy, że czas jest OK. Nie męczymy serwerów NTP.
    if (timeinfo.tm_year > (2020 - 1900)) {
        return; 
    }

    ESP_LOGI(TAG, "Czas nieaktualny (Rok 1970). Inicjalizacja SNTP...");

    // Inicjalizacja SNTP (tylko jeśli nie działa)
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_init();

    // Czekamy na synchronizację (max 5-8 sekund)
    int retry = 0;
    const int retry_count = 10;
    while (sntp_get_sync_status() == SNTP_SYNC_STATUS_RESET && ++retry < retry_count) {
        ESP_LOGI(TAG, "Czekam na czas... (%d/%d)", retry, retry_count);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
    
    // Ustawienie strefy czasowej (Polska: CET/CEST)
    setenv("TZ", "CET-1CEST,M3.5.0,M10.5.0/3", 1);
    tzset();

    // Logowanie wyniku
    time(&now);
    localtime_r(&now, &timeinfo);
    if (timeinfo.tm_year > (2020 - 1900)) {
        char strftime_buf[64];
        strftime(strftime_buf, sizeof(strftime_buf), "%c", &timeinfo);
        ESP_LOGI(TAG, "Czas zaktualizowany: %s", strftime_buf);
    } else {
        ESP_LOGW(TAG, "Nie udalo sie pobrac czasu!");
    }
}

// Funkcja pomocnicza do pobierania pomiaru
SensorData get_ds18b20_reading(ds18b20_device_handle_t sensor_handle) {
    SensorData d;
    
    // Pobranie aktualnego czasu systemowego
    struct timeval tv;
    gettimeofday(&tv, NULL);
    d.timestamp = (int64_t)tv.tv_sec;

    d.temp = -127.0; // Wartość błędu
    d.pressure = 0;  // Brak pomiaru ciśnienia
    d.sensor_id = -1; // Zostanie nadpisane w pętli

    if (sensor_handle == NULL) {
        ESP_LOGE(TAG, "Uchwyt czujnika jest NULL");
        return d;
    }

    // 1. Wyzwolenie pomiaru
    ESP_ERROR_CHECK(ds18b20_trigger_temperature_conversion(sensor_handle));
    
    // 2. Czekanie na konwersję (800ms)
    vTaskDelay(pdMS_TO_TICKS(800));

    // 3. Odczyt temperatury
    float temperature;
    if (ds18b20_get_temperature(sensor_handle, &temperature) == ESP_OK) {
        d.temp = temperature;
    } else {
        ESP_LOGE(TAG, "Błąd odczytu temperatury (CRC/Timeout)");
    }
    
    return d;
}

void app_main(void) {
    // --- 1. INICJALIZACJA SYSTEMU ---
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

    // --- 2. KONFIGURACJA ONEWIRE ---
    onewire_bus_handle_t bus = NULL;
    onewire_bus_config_t bus_config = {
        .bus_gpio_num = SENSOR_GPIO,
    };
    onewire_bus_rmt_config_t rmt_config = {
        .max_rx_bytes = 10, 
    };
    
    ESP_LOGI(TAG, "Inicjalizacja OneWire na GPIO %d...", SENSOR_GPIO);
    ESP_ERROR_CHECK(onewire_new_bus_rmt(&bus_config, &rmt_config, &bus));

    // --- 3. WYSZUKIWANIE CZUJNIKÓW ---
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
            ds18b20_config_t ds_cfg = {};
            if (ds18b20_new_device_from_enumeration(&next_onewire_device, &ds_cfg, &ds18b20s[ds18b20_device_num]) == ESP_OK) {
                ESP_LOGI(TAG, "Znaleziono DS18B20 -> ID: %d", ds18b20_device_num);
                ds18b20_device_num++;
            }
        }
    } while (search_result != ESP_ERR_NOT_FOUND && ds18b20_device_num < MAX_SENSORS);
    
    ESP_ERROR_CHECK(onewire_del_device_iter(iter));
    ESP_LOGI(TAG, "Znaleziono łącznie: %d czujników.", ds18b20_device_num);

    // --- 4. PĘTLA GŁÓWNA ---
    vTaskDelay(pdMS_TO_TICKS(1000));
    int cycle_counter = 0;

    while (1) {
        cycle_counter++;
        ESP_LOGI(TAG, "\n================ CYKL #%d ================", cycle_counter);

        // A. Łączenie z siecią i czasem
        ESP_LOGI(TAG, "[WiFi] Próba połączenia...");
        bool is_online = false;
        bool mqtt_ready = false;

        if (wifi_connect_start() == ESP_OK) {
            is_online = true;
            
            // Próba pobrania czasu (jeśli go nie mamy)
            obtain_time();

            ESP_LOGI(TAG, "[SYSTEM] ONLINE. Start MQTT...");
            if (mqtt_app_start()) {
                mqtt_ready = true;
                
                // Wysyłamy bufor tylko jeśli jesteśmy online
                if (offline_buffer_count() > 0) {
                    ESP_LOGW(TAG, "Wysyłanie bufora offline...");
                    offline_process_queue(mqtt_send_sensor_data);
                }
            }
        } else {
            ESP_LOGE(TAG, "Brak WiFi (Offline).");
        }

        // B. Weryfikacja czasu dla bufora
        time_t now;
        struct tm timeinfo;
        time(&now);
        localtime_r(&now, &timeinfo);
        
        // Czy mamy poprawny rok? (Większy niż 2020)
        bool time_is_valid = (timeinfo.tm_year > (2020 - 1900));
        
        if (!time_is_valid) {
             ESP_LOGW(TAG, "⚠️ CZAS NIEPRAWIDŁOWY (1970). Dane nie będą buforowane!");
        }

        // C. Pętla po czujnikach
        if (ds18b20_device_num > 0) {
            for (int i = 0; i < ds18b20_device_num; i++) {
                ESP_LOGI(TAG, "--- Czujnik %d ---", i);

                SensorData current_data = get_ds18b20_reading(ds18b20s[i]);
                current_data.sensor_id = i; 

                ESP_LOGI(TAG, "Odczyt ID[%d]: %.2f st. C", i, current_data.temp);

                // Logika Wysyłki / Zapisu
                if (mqtt_ready) {
                    // Mamy internet -> Wysyłamy
                    if (!mqtt_send_sensor_data(current_data)) {
                        ESP_LOGE(TAG, "Błąd MQTT. Próba buforowania...");
                        if (time_is_valid) offline_buffer_add(current_data);
                    } else {
                        ESP_LOGI(TAG, "Wysłano OK.");
                    }
                } else {
                    // Brak internetu -> Buforujemy TYLKO jeśli czas jest OK
                    if (time_is_valid) {
                        ESP_LOGI(TAG, "Offline -> Zapis do bufora.");
                        offline_buffer_add(current_data);
                    } else {
                        ESP_LOGW(TAG, "Offline + Zły czas -> Dane odrzucone.");
                    }
                }

                vTaskDelay(pdMS_TO_TICKS(100)); // Mała przerwa
            }
        } else {
            ESP_LOGE(TAG, "BRAK CZUJNIKÓW!");
        }

        // D. Zakończenie cyklu
        if (is_online) {
            mqtt_app_stop();
            wifi_connect_stop();
        }

        ESP_LOGI(TAG, "[SLEEP] Czekam 5 minut...");
        vTaskDelay(pdMS_TO_TICKS(300000));
    }
}