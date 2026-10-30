#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_task_wdt.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "esp_app_desc.h"
#include "esp_wifi.h"
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
#include "ota_manager.h"

static const char *TAG = "MAIN_SYSTEM";

// Konfiguracja
#define SENSOR_GPIO  GPIO_NUM_4
#define MAX_SENSORS  10  
#define LOOP_DELAY_MS 300000 // 5 minut

#define MAIN_WDT_TIMEOUT_MS  60000          // petla glowna bez esp_task_wdt_reset() dluzej = restart
#define SLEEP_CHUNK_MS       10000          // przerwa miedzy cyklami w kawalkach (reset watchdoga)
#define OTA_MAX_WAIT_MS      (5 * 60 * 1000) // dluzsze OTA = zawieszone, restart do obecnego firmware
#define BACKLOG_PER_CYCLE    500             // zaleglosci z bufora na cykl (10 paczek) - reszta w kolejnych cyklach
#define STATUS_MAX           512             // JSON statusu: ~140 B + 19 B na czujnik
#define STATUS_INTERVAL_MS   (60 * 60 * 1000) // status co godzine; po starcie i zmianie wyniku OTA - od razu

// Biezace pomiary ida jedna paczka - musza sie zmiescic w limicie paczki
_Static_assert(MAX_SENSORS <= OFFLINE_BATCH_MAX, "MAX_SENSORS > OFFLINE_BATCH_MAX");

// --- CZAS (SNTP) ---
#define SNTP_ATTEMPTS         3
#define SNTP_ATTEMPT_WAIT_MS  4000
#define TIME_RESYNC_US        (24LL * 60 * 60 * 1000000) // korekta dryfu zegara raz na dobe
#define TIME_RETRY_US         (60LL * 60 * 1000000)      // po nieudanej korekcie (czas wazny) - za godzine

static const char *s_ntp_servers[SNTP_ATTEMPTS] = { "pool.ntp.org", "time.google.com", "time.cloudflare.com" };
static volatile uint32_t s_sync_count = 0; // zwiekszany przez SNTP po kazdej synchronizacji
static int64_t s_last_sync_us = 0;         // esp_timer przy ostatniej synchronizacji, 0 = brak od startu
static int64_t s_last_attempt_us = 0;
static bool s_sntp_started = false;

static void time_sync_cb(struct timeval *tv) {
    s_sync_count++;
}

static bool system_time_is_set(void) {
    time_t now;
    struct tm timeinfo;
    time(&now);
    localtime_r(&now, &timeinfo);
    return timeinfo.tm_year > (2020 - 1900);
}

// Wywolywane po polaczeniu z Wi-Fi: pobiera czas, gdy go brak, i koryguje zegar raz na dobe
static void obtain_time(void) {
    int64_t now_us = esp_timer_get_time();
    bool time_set = system_time_is_set();

    if (time_set) {
        bool synced_recently = s_last_sync_us != 0 && now_us - s_last_sync_us < TIME_RESYNC_US;
        bool attempted_recently = s_last_attempt_us != 0 && now_us - s_last_attempt_us < TIME_RETRY_US;
        if (synced_recently || attempted_recently) return;
    }
    s_last_attempt_us = now_us;
    ESP_LOGI(TAG, "%s", time_set ? "Korekta zegara (SNTP)..." : "Brak czasu - synchronizacja SNTP...");

    uint32_t count_before = s_sync_count;
    for (int i = 0; i < SNTP_ATTEMPTS; i++) {
        // Kazda proba to nowe zapytanie do kolejnego serwera - lwIP sam ponawia dopiero po 15 s
        esp_sntp_setservername(0, s_ntp_servers[i]);
        if (!s_sntp_started) {
            esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
            sntp_set_time_sync_notification_cb(time_sync_cb);
            esp_sntp_init();
            s_sntp_started = true;
        } else {
            esp_sntp_restart();
        }

        for (int waited = 0; waited < SNTP_ATTEMPT_WAIT_MS; waited += 100) {
            if (s_sync_count != count_before) {
                s_last_sync_us = esp_timer_get_time();
                time_t now;
                struct tm timeinfo;
                char strftime_buf[64];
                time(&now);
                localtime_r(&now, &timeinfo);
                strftime(strftime_buf, sizeof(strftime_buf), "%c", &timeinfo);
                ESP_LOGI(TAG, "Czas zaktualizowany (%s): %s", s_ntp_servers[i], strftime_buf);
                return;
            }
            vTaskDelay(pdMS_TO_TICKS(100));
        }
        ESP_LOGW(TAG, "Brak odpowiedzi od %s", s_ntp_servers[i]);
    }
    ESP_LOGW(TAG, "Nie udalo sie pobrac czasu!");
}

// Wartosc rejestru temperatury DS18B20 zaraz po wlaczeniu zasilania
#define DS18B20_POR_TEMP 85.0f

static esp_err_t read_ds18b20_once(ds18b20_device_handle_t sensor_handle, float *temperature) {
    esp_err_t err = ds18b20_trigger_temperature_conversion(sensor_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Czujnik nie odpowiada na komende konwersji: %s", esp_err_to_name(err));
        return err;
    }

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

// Wysylka paczki z bufora - reset watchdoga przed kazda paczka
static bool send_buffered_batch(const SensorData *items, size_t count) {
    esp_task_wdt_reset();
    return mqtt_send_readings(items, count);
}

// Kiedy wyslano ostatni status - lista czujnikow zmienia sie tylko przy starcie, wiec sledzimy tylko wynik OTA
static int64_t s_last_status_us = 0;       // 0 = status jeszcze nie wyslany od startu
static ota_result_t s_last_status_ota = OTA_RESULT_NONE;

// Status: pierwszy po starcie, przy zmianie wyniku OTA, poza tym co STATUS_INTERVAL_MS
static bool status_due(void) {
    if (s_last_status_us == 0 || ota_last_result() != s_last_status_ota) {
        return true;
    }
    return esp_timer_get_time() - s_last_status_us >= (int64_t)STATUS_INTERVAL_MS * 1000;
}

// Stan plytki dla backendu: wersja, wykryte czujniki, wynik OTA, sila Wi-Fi, zaleglosci.
// Plytka offline = brak jakiejkolwiek wiadomosci (pomiary co interval_s, status co status_interval_s).
static void publish_status(const uint64_t *sensor_roms, int sensor_count) {
    static char json[STATUS_MAX];
    wifi_ap_record_t ap;
    int rssi = (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) ? ap.rssi : 0;
    ota_result_t ota = ota_last_result();

    int len = snprintf(json, sizeof(json),
                       "{\"fw\":\"%s\",\"ts\":%lld,\"interval_s\":%d,\"status_interval_s\":%d,\"sensors\":[",
                       esp_app_get_description()->version, (long long)time(NULL),
                       LOOP_DELAY_MS / 1000, STATUS_INTERVAL_MS / 1000);
    for (int i = 0; i < sensor_count && len < (int)sizeof(json); i++) {
        char rom_str[SENSOR_ROM_STR_LEN];
        sensor_rom_to_str(sensor_roms[i], rom_str);
        len += snprintf(json + len, sizeof(json) - len, "%s\"%s\"", (i > 0) ? "," : "", rom_str);
    }
    if (len < (int)sizeof(json)) {
        len += snprintf(json + len, sizeof(json) - len, "],\"ota\":\"%s\",\"rssi\":%d,\"buffered\":%u}",
                        ota_result_str(ota), rssi, (unsigned)offline_buffer_count());
    }
    if (len >= (int)sizeof(json)) {
        ESP_LOGE(TAG, "Status nie miesci sie w %d B", STATUS_MAX);
        return;
    }
    if (!mqtt_publish_status(json)) {
        ESP_LOGW(TAG, "Nie udalo sie wyslac statusu - ponowie w nastepnym cyklu");
        return;
    }
    s_last_status_us = esp_timer_get_time();
    s_last_status_ota = ota;
}

// Reset fabryczny (BOOT 10 s, wolany z taska przycisku): caly NVS (Wi-Fi, licznik bufora, wynik OTA)
// i zalegle pomiary - przy sprzedazy/przeniesieniu nic nie trafi na konto poprzedniego wlasciciela.
// Przerwany zapis main nie ma znaczenia - partycje i tak sa czyszczone.
static void factory_reset(void) {
    offline_buffer_erase_all();
    esp_err_t err = nvs_flash_erase();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Czyszczenie NVS nieudane: %s", esp_err_to_name(err));
    }
    ESP_LOGW(TAG, "Reset fabryczny zakonczony - restart");
    esp_restart();
}

// Restart tylko z petli glownej, gdy nic nie jest zapisywane do flasha
static void restart_safely(const char *reason) {
    ESP_LOGW(TAG, "Restart: %s", reason);
    vTaskDelay(pdMS_TO_TICKS(1000)); // czas na dostarczenie publikacji czyszczacej komende (QoS1)
    mqtt_app_stop();
    wifi_connect_stop();
    esp_restart();
}

void app_main(void) {
    ESP_ERROR_CHECK(storage_init());

    // Pierwszy start po OTA: bez polaczenia z MQTT w 15 min wracamy do poprzedniego firmware
    ota_rollback_guard_start();

    // Czas lokalny w logach
    setenv("TZ", "CET-1CEST,M3.5.0,M10.5.0/3", 1);
    tzset();

    ESP_ERROR_CHECK(esp_event_loop_create_default());
    offline_buffer_init();
    wifi_connect_init();
    // Brak zapisanej sieci (nowa plytka / po resecie fabrycznym) = BLE od razu, bez limitu czasu
    ble_config_init(GPIO_NUM_0, !wifi_has_credentials(), factory_reset);

    // 2. Inicjalizacja OneWire (wykonujemy raz przed pętlą)
    onewire_bus_handle_t bus = NULL;
    onewire_bus_config_t bus_config = {
        .bus_gpio_num = SENSOR_GPIO,
        // Odlaczony przewod DATA nie "wisi w powietrzu" (zewnetrzny 4,7k jest po stronie sond)
        .flags.en_pull_up = true,
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
    uint64_t sensor_roms[MAX_SENSORS]; // lista wykrytych czujnikow do statusu

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
                    sensor_roms[ds18b20_device_num] = next_onewire_device.address;
                    ds18b20_device_num++;
                }
            } else if (search_result != ESP_ERR_NOT_FOUND) {
                // Blad magistrali (odpiety przewod, zwarcie) - ponawianie w petli zablokowaloby start plytki
                ESP_LOGE(TAG, "Błąd magistrali 1-Wire podczas szukania (%s) - przerywam", esp_err_to_name(search_result));
            }
        } while (search_result == ESP_OK && ds18b20_device_num < MAX_SENSORS);
        
        onewire_del_device_iter(iter);
        ESP_LOGI(TAG, "Znaleziono łącznie: %d czujników.", ds18b20_device_num);
    }

    vTaskDelay(pdMS_TO_TICKS(1000));
    int cycle_counter = 0;

    // Watchdog petli glownej: zawieszenie na dluzej niz 60 s = restart plytki
    // (po OTA restart przed potwierdzeniem = powrot do poprzedniego firmware)
    esp_task_wdt_config_t wdt_cfg = {
        .timeout_ms = MAIN_WDT_TIMEOUT_MS,
        .idle_core_mask = (1 << CONFIG_FREERTOS_NUMBER_OF_CORES) - 1,
        .trigger_panic = true,
    };
    ESP_ERROR_CHECK(esp_task_wdt_reconfigure(&wdt_cfg));
    ESP_ERROR_CHECK(esp_task_wdt_add(NULL));

    // 3. Główna pętla nieskończona
    while (1) {
        esp_task_wdt_reset();
        cycle_counter++;
        ESP_LOGI(TAG, "\n================ CYKL #%d ================", cycle_counter);

        ESP_LOGI(TAG, "[WiFi] Próba połączenia...");
        bool is_online = false;
        bool mqtt_ready = false;

        if (wifi_connect_start() == ESP_OK) {
            is_online = true;
            esp_task_wdt_reset();

            obtain_time();
            esp_task_wdt_reset();

            ESP_LOGI(TAG, "[SYSTEM] ONLINE. Start MQTT...");
            mqtt_ready = mqtt_app_start();
            esp_task_wdt_reset();
        } else {
            ESP_LOGE(TAG, "Brak WiFi (Offline).");
        }

        bool time_is_valid = system_time_is_set();

        if (!time_is_valid) {
             ESP_LOGW(TAG, "⚠️ CZAS NIEPRAWIDŁOWY (1970). Dane nie będą buforowane!");
        }

        // 1. Pomiar wszystkich czujnikow (kazdy z wlasnym znacznikiem czasu).
        // Plytka bez zapisanej sieci (nowa / po resecie fabrycznym) nie ma wlasciciela - nie zbiera pomiarow,
        // inaczej po konfiguracji na konto nowego wlasciciela trafilyby pomiary sprzed przekazania.
        static SensorData readings[MAX_SENSORS];
        int reading_count = 0;
        int sensors_to_read = ds18b20_device_num;
        if (!wifi_has_credentials()) {
            ESP_LOGW(TAG, "Plytka nieskonfigurowana (brak Wi-Fi) - pomijam pomiary, czekam na konfiguracje BLE");
            sensors_to_read = 0;
        }
        for (int i = 0; i < sensors_to_read; i++) {
            esp_task_wdt_reset();
            ESP_LOGI(TAG, "--- Czujnik %d ---", i);

            readings[reading_count] = get_ds18b20_reading(ds18b20s[i]);

            char rom_str[SENSOR_ROM_STR_LEN];
            sensor_rom_to_str(readings[reading_count].sensor_rom, rom_str);
            ESP_LOGI(TAG, "Odczyt [%s]: %.2f st. C", rom_str, readings[reading_count].temp);
            reading_count++;
        }
        if (ds18b20_device_num == 0) {
            ESP_LOGE(TAG, "BRAK CZUJNIKÓW!");
        }

        // 2. Biezace pomiary jedna wiadomoscia - najpierw one, potem zaleglosci
        bool live_sent = false;
        if (reading_count > 0) {
            if (mqtt_ready) {
                live_sent = mqtt_send_readings(readings, reading_count);
                if (!live_sent) ESP_LOGE(TAG, "Błąd MQTT. Próba buforowania...");
            }
            if (!live_sent) {
                if (time_is_valid) {
                    ESP_LOGI(TAG, "Zapis %d pomiarow do bufora.", reading_count);
                    for (int i = 0; i < reading_count; i++) {
                        offline_buffer_add(readings[i]);
                    }
                } else {
                    ESP_LOGW(TAG, "Offline + Zły czas -> Dane odrzucone.");
                }
            }
        }
        esp_task_wdt_reset();

        // 3. Zaleglosci z bufora paczkami (pomijamy, gdy wysylka biezacych sie nie udala - polaczenie nie dziala)
        if (mqtt_ready && (reading_count == 0 || live_sent) && offline_buffer_count() > 0) {
            ESP_LOGW(TAG, "Wysyłanie bufora offline (%u pomiarow)...", (unsigned)offline_buffer_count());
            offline_process_queue(send_buffered_batch, BACKLOG_PER_CYCLE);
        }

        // --- OTA: Wi-Fi zostaje wlaczone do konca pobierania ---
        if (ota_is_running()) {
            ESP_LOGW(TAG, "Trwa OTA - czekam z wylaczeniem Wi-Fi (max %d s)...", OTA_MAX_WAIT_MS / 1000);
            for (int waited_ms = 0; ota_is_running() && waited_ms < OTA_MAX_WAIT_MS; waited_ms += 1000) {
                esp_task_wdt_reset();
                vTaskDelay(pdMS_TO_TICKS(1000));
            }
            if (ota_is_running()) {
                // Niedokonczone OTA nie zmienia slotu startowego - po restarcie dziala obecny firmware
                ota_report_timeout();
                restart_safely("OTA trwa ponad 5 min");
            }
        }

        // --- Status plytki (takze bez czujnikow - sygnal zycia): po starcie, przy zmianie OTA, co godzine ---
        if (mqtt_ready && (reading_count == 0 || live_sent) && status_due()) {
            esp_task_wdt_reset();
            publish_status(sensor_roms, ds18b20_device_num);
        }

        // --- Restarty z komend: pomiary wyslane, bufor zamkniety - bezpieczny moment ---
        if (ota_restart_pending()) {
            restart_safely("nowy firmware po OTA");
        }
        if (mqtt_restart_requested()) {
            restart_safely("komenda reset z MQTT");
        }

        if (is_online) {
            ESP_LOGI(TAG, "Zamykanie połączeń na czas przerwy...");
            mqtt_app_stop();
            wifi_connect_stop();
        }

        // Najmniejszy wolny stos main od startu (bajty) - kontrola zapasu CONFIG_ESP_MAIN_TASK_STACK_SIZE
        ESP_LOGI(TAG, "[SLEEP] Czekam %d s... (min. wolny stos main: %u B)",
                 LOOP_DELAY_MS / 1000, (unsigned)uxTaskGetStackHighWaterMark(NULL));
        // Przerwa w kawalkach - watchdog pilnuje petli takze w czasie czekania
        for (int slept_ms = 0; slept_ms < LOOP_DELAY_MS; slept_ms += SLEEP_CHUNK_MS) {
            esp_task_wdt_reset();
            int chunk_ms = LOOP_DELAY_MS - slept_ms;
            vTaskDelay(pdMS_TO_TICKS(chunk_ms < SLEEP_CHUNK_MS ? chunk_ms : SLEEP_CHUNK_MS));
        }
    }
}