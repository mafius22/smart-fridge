#include "ble_config.h"
#include "storage_manager.h"

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/timers.h"
#include "esp_log.h"
#include "driver/gpio.h"

// Nagłówki BLE (Bluedroid)
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_gap_ble_api.h"
#include "esp_gatts_api.h"

static const char *TAG = "BLE_CONFIG";

// --- KONFIGURACJA ---
#define CONFIG_TIMEOUT_MS   (120 * 1000) // 2 minuty (czas na konfigurację)
#define DEVICE_NAME         "ESP32_SETUP"

// UUID dla serwisu i charakterystyk (16-bitowe dla prostoty)
#define SERVICE_UUID        0x00FF
#define CHAR_SSID_UUID      0xFF01
#define CHAR_PASS_UUID      0xFF02

// Zmienne globalne modułu
static bool s_ble_is_active = false;
static TimerHandle_t s_timeout_timer = NULL;
static uint16_t s_service_handle;
static uint16_t s_char_ssid_handle;
static uint16_t s_char_pass_handle;

// Deklaracje funkcji wewnętrznych
static void gap_event_handler(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param);
static void gatts_event_handler(esp_gatts_cb_event_t event, esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t *param);
static void ble_timeout_callback(TimerHandle_t xTimer);

// --- OBSŁUGA PRZYCISKU ---

static void button_task(void *arg) {
    gpio_reset_pin(BLE_CONFIG_BUTTON_GPIO);
    gpio_set_direction(BLE_CONFIG_BUTTON_GPIO, GPIO_MODE_INPUT);
    gpio_set_pull_mode(BLE_CONFIG_BUTTON_GPIO, GPIO_PULLUP_ONLY); // Zakładamy przycisk zwierający do masy

    int hold_time_ms = 0;
    const int check_interval = 100; // sprawdzamy co 100ms
    const int trigger_time = 4000;  // 4 sekundy

    while (1) {
        if (gpio_get_level(BLE_CONFIG_BUTTON_GPIO) == 0) {
            hold_time_ms += check_interval;
            
            // Logowanie postępu co sekundę dla informacji
            if (hold_time_ms % 1000 == 0 && hold_time_ms > 0 && hold_time_ms < trigger_time) {
                ESP_LOGI(TAG, "Przytrzymaj przycisk... %d/4s", hold_time_ms/1000);
            }

            if (hold_time_ms >= trigger_time) {
                if (!s_ble_is_active) {
                    ESP_LOGI(TAG, ">>> START TRYBU KONFIGURACJI BLE <<<");
                    ble_config_start();
                    
                    // Czekaj aż użytkownik puści przycisk, żeby nie restartować cyklu
                    while(gpio_get_level(BLE_CONFIG_BUTTON_GPIO) == 0) {
                        vTaskDelay(pdMS_TO_TICKS(100));
                    }
                } else {
                     ESP_LOGI(TAG, "BLE jest juz aktywne. Restartuje licznik czasu.");
                     xTimerReset(s_timeout_timer, 0);
                     // Czekaj na puszczenie
                     while(gpio_get_level(BLE_CONFIG_BUTTON_GPIO) == 0) vTaskDelay(pdMS_TO_TICKS(100));
                }
                hold_time_ms = 0;
            }
        } else {
            hold_time_ms = 0;
        }
        vTaskDelay(pdMS_TO_TICKS(check_interval));
    }
}

// --- ZARZĄDZANIE BLE (START/STOP) ---

void ble_config_start(void) {
    if (s_ble_is_active) return;

    esp_err_t ret;

    // 1. Włącz kontroler BLE
    ret = esp_bt_controller_enable(ESP_BT_MODE_BLE);
    if (ret) {
        ESP_LOGE(TAG, "Blad enable controller: %s", esp_err_to_name(ret));
        return;
    }

    // 2. Włącz Bluedroid
    ret = esp_bluedroid_enable();
    if (ret) {
        ESP_LOGE(TAG, "Blad enable bluedroid: %s", esp_err_to_name(ret));
        // Ważne: Jeśli bluedroid nie wstanie, wyłączamy kontroler, żeby nie został "wiszący"
        esp_bt_controller_disable();
        return;
    }

    // 3. Rejestracja callbacków i aplikacji
    
    // a) Rejestracja wskaźników funkcji - to wystarczy zrobić raz w życiu programu
    static bool callbacks_registered = false;
    if (!callbacks_registered) {
        ret = esp_ble_gatts_register_callback(gatts_event_handler);
        if (ret){ ESP_LOGE(TAG, "gatts register error: %x", ret); return; }
        
        ret = esp_ble_gap_register_callback(gap_event_handler);
        if (ret){ ESP_LOGE(TAG, "gap register error: %x", ret); return; }
        
        callbacks_registered = true;
    }

    // b) Rejestracja aplikacji - TO MUSI BYĆ WYKONANE PRZY KAŻDYM STARCIE!
    // To wywołanie generuje zdarzenie ESP_GATTS_REG_EVT, które buduje Twój serwis.
    ret = esp_ble_gatts_app_register(0); 
    if (ret) {
        ESP_LOGE(TAG, "gatts app register error: %x", ret);
        return;
    }

    s_ble_is_active = true;
    
    // 4. Start Timera
    // Resetujemy timer, żeby liczył od nowa 2 minuty
    xTimerReset(s_timeout_timer, 0); 
    ESP_LOGI(TAG, "Bluetooth wlaczony. Czekam na polaczenie przez 2 minuty...");
}
void ble_config_stop(void) {
    if (!s_ble_is_active) return;

    ESP_LOGI(TAG, "Zatrzymywanie BLE...");

    // Zatrzymaj timer
    xTimerStop(s_timeout_timer, 0);

    // Zatrzymaj reklamowanie
    esp_ble_gap_stop_advertising();

    // Wyłącz stos
    esp_bluedroid_disable();
    esp_bt_controller_disable();
    
    s_ble_is_active = false;
    ESP_LOGI(TAG, "BLE Wylaczone (Radio OFF).");
}

static void ble_timeout_callback(TimerHandle_t xTimer) {
    ESP_LOGW(TAG, "Koniec czasu konfiguracji (Timeout).");
    ble_config_stop();
}

// --- CALLBACKI BLE (GAP - Reklamowanie) ---

static void gap_event_handler(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param) {
    switch (event) {
        case ESP_GAP_BLE_ADV_DATA_SET_COMPLETE_EVT:
            // Dane ustawione, startujemy reklamowanie
            esp_ble_gap_start_advertising(&(esp_ble_adv_params_t){
                .adv_int_min = 0x20,
                .adv_int_max = 0x40,
                .adv_type = ADV_TYPE_IND,
                .own_addr_type = BLE_ADDR_TYPE_PUBLIC,
                .channel_map = ADV_CHNL_ALL,
                .adv_filter_policy = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY,
            });
            break;
        
        case ESP_GAP_BLE_ADV_START_COMPLETE_EVT:
            if (param->adv_start_cmpl.status == ESP_BT_STATUS_SUCCESS) {
                ESP_LOGI(TAG, "Reklamowanie aktywne. Szukaj urzadzenia: %s", DEVICE_NAME);
            } else {
                ESP_LOGE(TAG, "Nie udalo sie wlaczyc reklamowania.");
            }
            break;

        default:
            break;
    }
}

// --- CALLBACKI BLE (GATT - Obsługa danych) ---

static void gatts_event_handler(esp_gatts_cb_event_t event, esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t *param) {
    switch (event) {
        case ESP_GATTS_REG_EVT: {
            // Konfiguracja nazwy urządzenia
            esp_ble_gap_set_device_name(DEVICE_NAME);
            
            // Konfiguracja pakietu reklamowego
            esp_ble_gap_config_adv_data(&(esp_ble_adv_data_t){
                .set_scan_rsp = false,
                .include_name = true,
                .include_txpower = true,
                .min_interval = 0x20,
                .max_interval = 0x40,
                .appearance = 0x00,
                .flag = (ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT),
            });

            // Tworzenie serwisu
            esp_gatt_srvc_id_t service_id = {
                .is_primary = true,
                .id.inst_id = 0x00,
                .id.uuid.len = ESP_UUID_LEN_16,
                .id.uuid.uuid.uuid16 = SERVICE_UUID
            };
            esp_ble_gatts_create_service(gatts_if, &service_id, 4);
            break;
        }

        case ESP_GATTS_CREATE_EVT: // Serwis utworzony
            s_service_handle = param->create.service_handle;

            // --- POPRAWKA 1: Użycie poprawnego typu esp_bt_uuid_t ---
            esp_bt_uuid_t uuid_ssid = { .len = ESP_UUID_LEN_16, .uuid.uuid16 = CHAR_SSID_UUID };
            esp_ble_gatts_add_char(s_service_handle, &uuid_ssid,
                                   ESP_GATT_PERM_WRITE,
                                   ESP_GATT_CHAR_PROP_BIT_WRITE, 
                                   NULL, NULL);
            
            // --- POPRAWKA 1: Użycie poprawnego typu esp_bt_uuid_t ---
            esp_bt_uuid_t uuid_pass = { .len = ESP_UUID_LEN_16, .uuid.uuid16 = CHAR_PASS_UUID };
            esp_ble_gatts_add_char(s_service_handle, &uuid_pass,
                                   ESP_GATT_PERM_WRITE,
                                   ESP_GATT_CHAR_PROP_BIT_WRITE, 
                                   NULL, NULL);
            
            esp_ble_gatts_start_service(s_service_handle);
            break;

        case ESP_GATTS_ADD_CHAR_EVT: // Charakterystyka dodana, zapiszmy jej uchwyt
            if (param->add_char.char_uuid.uuid.uuid16 == CHAR_SSID_UUID) {
                s_char_ssid_handle = param->add_char.attr_handle;
            } else if (param->add_char.char_uuid.uuid.uuid16 == CHAR_PASS_UUID) {
                s_char_pass_handle = param->add_char.attr_handle;
            }
            break;

        case ESP_GATTS_CONNECT_EVT:
            ESP_LOGI(TAG, "Klient polaczony! (Timer nadal odlicza)");
            break;

        case ESP_GATTS_DISCONNECT_EVT:
            ESP_LOGI(TAG, "Klient rozlaczony.");
            // Jeśli nadal aktywny (nie minął czas), wznów reklamowanie
            if (s_ble_is_active) {
                esp_ble_gap_start_advertising(&(esp_ble_adv_params_t){
                    .adv_int_min = 0x20, .adv_int_max = 0x40,
                    .adv_type = ADV_TYPE_IND, .own_addr_type = BLE_ADDR_TYPE_PUBLIC,
                    .channel_map = ADV_CHNL_ALL, .adv_filter_policy = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY,
                });
            }
            break;

        case ESP_GATTS_WRITE_EVT: {
            // Ktoś coś napisał do nas
            if (param->write.len > 0) {
                char data_buf[65] = {0};
                int len = (param->write.len > 64) ? 64 : param->write.len;
                memcpy(data_buf, param->write.value, len);
                data_buf[len] = '\0'; // Null-terminate

                if (param->write.handle == s_char_ssid_handle) {
                    ESP_LOGI(TAG, "Zapisuje SSID: %s", data_buf);
                    storage_save_str("wifi", "ssid", data_buf);
                } 
                else if (param->write.handle == s_char_pass_handle) {
                    ESP_LOGI(TAG, "Zapisuje PASS: %s", data_buf);
                    storage_save_str("wifi", "pass", data_buf);
                }

                // Odpowiedź do klienta (ważne przy Write Request)
                if (param->write.need_rsp) {
                    // --- POPRAWKA 2: Użycie poprawnej nazwy funkcji ---
                    esp_ble_gatts_send_response(gatts_if, param->write.conn_id, param->write.trans_id, ESP_GATT_OK, NULL);
                }
            }
            break;
        }
        default: break;
    }
}

// --- INITIALIZACJA ---

void ble_config_init(void) {
    esp_err_t ret;

    // 1. Konfiguracja Kontrolera (Warstwa sprzętowa)
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    
    // TO MUSI BYĆ PIERWSZE!
    ret = esp_bt_controller_init(&bt_cfg);
    if (ret != ESP_OK) {
        // Jeśli to się nie uda, nie ma sensu iść dalej
        ESP_LOGE(TAG, "FATAL: Controller Init Failed: %s", esp_err_to_name(ret));
        return; 
    }

    // 2. Inicjalizacja Bluedroid (Stos programowy)
    // To wywoła błąd "Controller not initialised", jeśli krok 1 się nie udał.
    ret = esp_bluedroid_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "FATAL: Bluedroid Init Failed: %s", esp_err_to_name(ret));
        // Sprzątamy po kontrolerze
        esp_bt_controller_deinit();
        return;
    }

    // 3. Konfiguracja Timera i Taska
    if (s_timeout_timer == NULL) {
        s_timeout_timer = xTimerCreate("BLE_Timeout", pdMS_TO_TICKS(CONFIG_TIMEOUT_MS), 
                                       pdFALSE, (void*)0, ble_timeout_callback);
    }
    
    // Zabezpieczenie przed podwójnym tworzeniem taska
    static bool task_created = false;
    if (!task_created) {
        xTaskCreate(button_task, "ble_btn_task", 2048, NULL, 10, NULL);
        task_created = true;
    }

    ESP_LOGI(TAG, "BLE Init Success (Czekam na przycisk).");
}