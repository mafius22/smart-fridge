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
#include <time.h>        
#include "esp_sntp.h"   
#include <stdbool.h>   

#include "onewire_bus.h"
#include "ds18b20.h"

#include "storage_manager.h"
#include "offline_buffer.h"
#include "wifi_connect.h"
#include "ble_config.h"
#include "mqtt_handler.h"

static const char *TAG = "MAIN_SYSTEM";

// Konfiguracja
#define SENSOR_GPIO  GPIO_NUM_4
#define MAX_SENSORS  10  
#define LOOP_DELAY_MS 300000 // 5 minut

// Flaga globalna (musi być ustawiana przez mqtt_handler/ota_manager)
bool g_ota_trwa = false;

// --- FUNKCJA DO POBIERANIA CZASU---
static void obtain_time(void) {
    time_t now;
    struct tm timeinfo;
    time(&now);
    localtime_r(&now, &timeinfo);

    if (timeinfo.tm_year > (2020 - 1900)) {
        return; 
    }

    ESP_LOGI(TAG, "Czas nieaktualny (Rok 1970). Inicjalizacja SNTP...");

    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_init();

    int retry = 0;
    const int retry_count = 10;
    while (sntp_get_sync_status() == SNTP_SYNC_STATUS_RESET && ++retry < retry_count) {
        ESP_LOGI(TAG, "Czekam na czas... (%d/%d)", retry, retry_count);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
    
    setenv("TZ", "CET-1CEST,M3.5.0,M10.5.0/3", 1);
    tzset();

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

// Wartosc rejestru temperatury DS18B20 zaraz po wlaczeniu zasilania
#define DS18B20_POR_TEMP 85.0f

static esp_err_t read_ds18b20_once(ds18b20_device_handle_t sensor_handle, float *temperature) {
    esp_err_t err = ds18b20_trigger_temperature_conversion(sensor_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Czujnik nie odpowiada na komende konwersji: %s", esp_err_to_name(err));
        return err;
    }

    vTaskDelay(pdMS_TO_TICKS(800));

    err = ds18b20_get_temperature(sensor_handle, temperature);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Błąd odczytu temperatury (CRC/Timeout)");
    }
    return err;
}

SensorData get_ds18b20_reading(ds18b20_device_handle_t sensor_handle) {
    SensorData d;
    
    struct timeval tv;
    gettimeofday(&tv, NULL);
    d.timestamp = (int64_t)tv.tv_sec;

    d.temp = -127.0;
    d.sensor_rom = 0;

    if (sensor_handle == NULL) {
        ESP_LOGE(TAG, "Uchwyt czujnika jest NULL");
        return d;
    }

    // ROM ustawiamy przed pomiarem - przy bledzie (-127) wiadomo, ktory czujnik nie odpowiada
    ds18b20_get_device_address(sensor_handle, &d.sensor_rom);

    float temperature;
    if (read_ds18b20_once(sensor_handle, &temperature) != ESP_OK) {
        return d;
    }

    // 85.0 to nie pomiar, tylko wartosc startowa rejestru po zaniku zasilania czujnika
    if (temperature == DS18B20_POR_TEMP) {
        ESP_LOGW(TAG, "Odczyt 85.0 st. C (reset zasilania czujnika?) - ponawiam pomiar");
        if (read_ds18b20_once(sensor_handle, &temperature) != ESP_OK) {
            return d;
        }
        if (temperature == DS18B20_POR_TEMP) {
            ESP_LOGE(TAG, "Ponownie 85.0 st. C - traktuje jako blad czujnika");
            return d;
        }
    }

    d.temp = temperature;
    return d;
}

void app_main(void) {
    // 1. Inicjalizacja podstawowa
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

    // 2. Inicjalizacja OneWire (wykonujemy raz przed pętlą)
    onewire_bus_handle_t bus = NULL;
    onewire_bus_config_t bus_config = {
        .bus_gpio_num = SENSOR_GPIO,
    };
    onewire_bus_rmt_config_t rmt_config = {
        .max_rx_bytes = 10, 
    };
    
    ESP_LOGI(TAG, "Inicjalizacja OneWire na GPIO %d...", SENSOR_GPIO);
    // Sprawdzamy błąd, ale nie zabijamy programu (może nie być czujników)
    if (onewire_new_bus_rmt(&bus_config, &rmt_config, &bus) != ESP_OK) {
        ESP_LOGE(TAG, "Błąd inicjalizacji OneWire Bus!");
    }

    int ds18b20_device_num = 0;
    ds18b20_device_handle_t ds18b20s[MAX_SENSORS];
    
    if (bus) {
        onewire_device_iter_handle_t iter = NULL;
        onewire_device_t next_onewire_device;
        esp_err_t search_result = ESP_OK;

        onewire_new_device_iter(bus, &iter);
        ESP_LOGI(TAG, "Szukanie urządzeń...");

        do {
            search_result = onewire_device_iter_get_next(iter, &next_onewire_device);
            if (search_result == ESP_OK) { 
                ds18b20_config_t ds_cfg = {};
                if (ds18b20_new_device_from_enumeration(&next_onewire_device, &ds_cfg, &ds18b20s[ds18b20_device_num]) == ESP_OK) {
                    char rom_str[SENSOR_ROM_STR_LEN];
                    sensor_rom_to_str(next_onewire_device.address, rom_str);
                    ESP_LOGI(TAG, "Znaleziono DS18B20 -> ROM: %s", rom_str);
                    ds18b20_device_num++;
                }
            }
        } while (search_result != ESP_ERR_NOT_FOUND && ds18b20_device_num < MAX_SENSORS);
        
        onewire_del_device_iter(iter);
        ESP_LOGI(TAG, "Znaleziono łącznie: %d czujników.", ds18b20_device_num);
    }

    vTaskDelay(pdMS_TO_TICKS(1000));
    int cycle_counter = 0;

    // 3. Główna pętla nieskończona
    while (1) {
        cycle_counter++;
        ESP_LOGI(TAG, "\n================ CYKL #%d ================", cycle_counter);

        ESP_LOGI(TAG, "[WiFi] Próba połączenia...");
        bool is_online = false;
        bool mqtt_ready = false;

        if (wifi_connect_start() == ESP_OK) {
            is_online = true;
            
            obtain_time();

            ESP_LOGI(TAG, "[SYSTEM] ONLINE. Start MQTT...");
            if (mqtt_app_start()) {
                mqtt_ready = true;
                
                // Jeśli mamy dane w buforze, wyślij je teraz
                if (offline_buffer_count() > 0) {
                    ESP_LOGW(TAG, "Wysyłanie bufora offline...");
                    offline_process_queue(mqtt_send_sensor_data);
                }
            }
        } else {
            ESP_LOGE(TAG, "Brak WiFi (Offline).");
        }

        time_t now;
        struct tm timeinfo;
        time(&now);
        localtime_r(&now, &timeinfo);
        
        bool time_is_valid = (timeinfo.tm_year > (2020 - 1900));
        
        if (!time_is_valid) {
             ESP_LOGW(TAG, "⚠️ CZAS NIEPRAWIDŁOWY (1970). Dane nie będą buforowane!");
        }

        // Odczyt czujników
        if (ds18b20_device_num > 0) {
            for (int i = 0; i < ds18b20_device_num; i++) {
                ESP_LOGI(TAG, "--- Czujnik %d ---", i);

                SensorData current_data = get_ds18b20_reading(ds18b20s[i]);

                char rom_str[SENSOR_ROM_STR_LEN];
                sensor_rom_to_str(current_data.sensor_rom, rom_str);
                ESP_LOGI(TAG, "Odczyt [%s]: %.2f st. C", rom_str, current_data.temp);

                if (mqtt_ready) {
                    if (!mqtt_send_sensor_data(current_data)) {
                        ESP_LOGE(TAG, "Błąd MQTT. Próba buforowania...");
                        if (time_is_valid) offline_buffer_add(current_data);
                    } else {
                        ESP_LOGI(TAG, "Wysłano OK.");
                    }
                } else {
                    if (time_is_valid) {
                        ESP_LOGI(TAG, "Offline -> Zapis do bufora.");
                        offline_buffer_add(current_data);
                    } else {
                        ESP_LOGW(TAG, "Offline + Zły czas -> Dane odrzucone.");
                    }
                }

                vTaskDelay(pdMS_TO_TICKS(100)); 
            }
        } else {
            ESP_LOGE(TAG, "BRAK CZUJNIKÓW!");
        }

        // --- KLUCZOWE: OCHRONA OTA ---
        // Sprawdzamy, czy trwa OTA zanim odłączymy sieć
        if (g_ota_trwa) {
            ESP_LOGW(TAG, "*********** TRWA OTA - WSTRZYMUJE ROZLACZANIE ***********");
            ESP_LOGW(TAG, "Nie wylaczam WiFi, czekam na zakonczenie aktualizacji...");
            
            // Pętla czekająca na zakończenie OTA
            while (g_ota_trwa) {
                // Tutaj system "wisi" i pozwala działać procesowi OTA w tle.
                // Jeśli OTA się uda -> nastąpi restart systemu.
                // Jeśli OTA się nie uda -> flaga g_ota_trwa zmieni się na false (w ota_manager).
                vTaskDelay(pdMS_TO_TICKS(1000));
            }
            ESP_LOGW(TAG, "Flaga OTA zgasla (blad lub timeout). Kontynuuje petle.");
        }

        // Rozłączamy tylko wtedy, gdy OTA NIE TRWA
        if (is_online && !g_ota_trwa) {
            ESP_LOGI(TAG, "Zamykanie połączeń na czas przerwy...");
            mqtt_app_stop();
            wifi_connect_stop();
        }

        ESP_LOGI(TAG, "[SLEEP] Czekam 5 minut...");
        vTaskDelay(pdMS_TO_TICKS(LOOP_DELAY_MS));
    }
}