#include "ble_config.h"
#include "storage_manager.h" // Upewnij się, że ta ścieżka jest poprawna dla Twojej struktury!
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/timers.h"
#include "esp_log.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "driver/gpio.h"

// Biblioteki Bluetooth
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_gap_ble_api.h"
#include "esp_gatts_api.h"
#include "esp_bt_defs.h"

static const char *TAG = "BLE_CONFIG";

// --- KONFIGURACJA ---
#define DEVICE_NAME             "ESP32_SMART_FRIDGE"
#define BUTTON_HOLD_TIME_MS     4000
#define BLE_TIMEOUT_MS          (3 * 60 * 1000)

// --- UUID ---
#define GATTS_SERVICE_UUID_TEST   0x00FF
#define GATTS_CHAR_UUID_SSID      0xFF01
#define GATTS_CHAR_UUID_PASS      0xFF02
#define GATTS_CHAR_UUID_ACTION    0xFF03
#define GATTS_NUM_HANDLE_TEST     8

// --- ZMIENNE GLOBALNE ---
static TimerHandle_t s_ble_timer = NULL;
static gpio_num_t s_btn_gpio = GPIO_NUM_0; // Domyślnie 0, ale zostanie nadpisane w init
static bool s_ble_is_active = false;

static char s_wifi_ssid[33] = {0};
static char s_wifi_pass[65] = {0};

static uint16_t s_handle_ssid = 0;
static uint16_t s_handle_pass = 0;
static uint16_t s_handle_action = 0;

/* --- PROTOTYPY FUNKCJI (To naprawia błąd "implicit declaration") --- */
static void ble_timeout_callback(TimerHandle_t xTimer);
static void ble_config_start(void); // Zmieniono nazwę, aby pasowała do wywołania w button_task
static void ble_config_stop_internal(void);

// ----------------------------------------------------------------------------
//                              OBSŁUGA BLUETOOTH
// ----------------------------------------------------------------------------

static void gap_event_handler(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param) {
    switch (event) {
        case ESP_GAP_BLE_ADV_DATA_SET_COMPLETE_EVT:
            esp_ble_gap_start_advertising(&(esp_ble_adv_params_t){
                .adv_int_min        = 0x20,
                .adv_int_max        = 0x40,
                .adv_type           = ADV_TYPE_IND,
                .own_addr_type      = BLE_ADDR_TYPE_PUBLIC,
                .channel_map        = ADV_CHNL_ALL,
                .adv_filter_policy = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY,
            });
            break;
        case ESP_GAP_BLE_ADV_START_COMPLETE_EVT:
            if (param->adv_start_cmpl.status == ESP_BT_STATUS_SUCCESS) {
                ESP_LOGI(TAG, "Rozglaszanie BLE uruchomione.");
            }
            break;
        case ESP_GAP_BLE_SEC_REQ_EVT:
            esp_ble_gap_security_rsp(param->ble_security.ble_req.bd_addr, true);
            break;
        default:
            break;
    }
}

static void gatts_event_handler(esp_gatts_cb_event_t event, esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t *param) {
    switch (event) {
        case ESP_GATTS_REG_EVT:
            esp_ble_gap_set_device_name(DEVICE_NAME);
            esp_ble_gap_config_adv_data(&(esp_ble_adv_data_t){
                .set_scan_rsp = false,
                .include_name = true,
                .include_txpower = true,
                .min_interval = 0x20,
                .max_interval = 0x40,
                .appearance = 0x00,
                .manufacturer_len = 0,
                .p_manufacturer_data =  NULL,
                .service_data_len = 0,
                .p_service_data = NULL,
                .service_uuid_len = 0,
                .p_service_uuid = NULL,
                .flag = (ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT),
            });

            esp_gatt_srvc_id_t service_id;
            service_id.is_primary = true;
            service_id.id.inst_id = 0x00;
            service_id.id.uuid.len = ESP_UUID_LEN_16;
            service_id.id.uuid.uuid.uuid16 = GATTS_SERVICE_UUID_TEST;

            esp_ble_gatts_create_service(gatts_if, &service_id, GATTS_NUM_HANDLE_TEST);
            break;

        case ESP_GATTS_CREATE_EVT:
            ESP_LOGI(TAG, "Serwis utworzony, handle: %d", param->create.service_handle);
            uint16_t service_handle = param->create.service_handle;
            esp_ble_gatts_start_service(service_handle);

            esp_bt_uuid_t char_uuid_ssid = { .len = ESP_UUID_LEN_16, .uuid = { .uuid16 = GATTS_CHAR_UUID_SSID } };
            esp_ble_gatts_add_char(service_handle, &char_uuid_ssid, ESP_GATT_PERM_WRITE, ESP_GATT_CHAR_PROP_BIT_WRITE, NULL, NULL);

            esp_bt_uuid_t char_uuid_pass = { .len = ESP_UUID_LEN_16, .uuid = { .uuid16 = GATTS_CHAR_UUID_PASS } };
            esp_ble_gatts_add_char(service_handle, &char_uuid_pass, ESP_GATT_PERM_WRITE, ESP_GATT_CHAR_PROP_BIT_WRITE, NULL, NULL);

            esp_bt_uuid_t char_uuid_act = { .len = ESP_UUID_LEN_16, .uuid = { .uuid16 = GATTS_CHAR_UUID_ACTION } };
            esp_ble_gatts_add_char(service_handle, &char_uuid_act, ESP_GATT_PERM_WRITE, ESP_GATT_CHAR_PROP_BIT_WRITE, NULL, NULL);
            break;

        case ESP_GATTS_ADD_CHAR_EVT:
            if (param->add_char.char_uuid.uuid.uuid16 == GATTS_CHAR_UUID_SSID) {
                s_handle_ssid = param->add_char.attr_handle;
            } else if (param->add_char.char_uuid.uuid.uuid16 == GATTS_CHAR_UUID_PASS) {
                s_handle_pass = param->add_char.attr_handle;
            } else if (param->add_char.char_uuid.uuid.uuid16 == GATTS_CHAR_UUID_ACTION) {
                s_handle_action = param->add_char.attr_handle;
            }
            break;

        case ESP_GATTS_WRITE_EVT:
            ESP_LOGI(TAG, "Otrzymano dane na handle %d, len: %d", param->write.handle, param->write.len);
            if (s_ble_timer) xTimerReset(s_ble_timer, 0);

            if (param->write.handle == s_handle_ssid) {
                memset(s_wifi_ssid, 0, sizeof(s_wifi_ssid));
                int len = (param->write.len >= sizeof(s_wifi_ssid)) ? (sizeof(s_wifi_ssid)-1) : param->write.len;
                memcpy(s_wifi_ssid, param->write.value, len);
                ESP_LOGI(TAG, "Otrzymano SSID: %s", s_wifi_ssid);
            } else if (param->write.handle == s_handle_pass) {
                memset(s_wifi_pass, 0, sizeof(s_wifi_pass));
                int len = (param->write.len >= sizeof(s_wifi_pass)) ? (sizeof(s_wifi_pass)-1) : param->write.len;
                memcpy(s_wifi_pass, param->write.value, len);
                ESP_LOGI(TAG, "Otrzymano Haslo (dlugosc %d)", len);
            } else if (param->write.handle == s_handle_action) {
                if (param->write.len > 0 && (param->write.value[0] == '1' || param->write.value[0] == 0x01)) {
                    if (strlen(s_wifi_ssid) > 0) {
                        ESP_LOGI(TAG, "Zapisywanie do NVS...");
                        storage_save_str("wifi", "ssid", s_wifi_ssid);
                        storage_save_str("wifi", "pass", s_wifi_pass);
                        ESP_LOGW(TAG, "Dane zapisane. Restart ESP...");
                        vTaskDelay(pdMS_TO_TICKS(500));
                        esp_restart();
                    }
                }
            }
            if (param->write.need_rsp) {
                esp_ble_gatts_send_response(gatts_if, param->write.conn_id, param->write.trans_id, ESP_GATT_OK, NULL);
            }
            break;

        case ESP_GATTS_CONNECT_EVT:
            ESP_LOGI(TAG, "Urzadzenie podlaczone.");
            if (s_ble_timer) xTimerReset(s_ble_timer, 0);
            break;

        case ESP_GATTS_DISCONNECT_EVT:
            ESP_LOGI(TAG, "Rozlaczono. Ponawiam rozglaszanie...");
            esp_ble_gap_start_advertising(&(esp_ble_adv_params_t){
                .adv_int_min = 0x20, .adv_int_max = 0x40,
                .adv_type = ADV_TYPE_IND, .own_addr_type = BLE_ADDR_TYPE_PUBLIC,
                .channel_map = ADV_CHNL_ALL, .adv_filter_policy = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY,
            });
            break;
        default: break;
    }
}

// ----------------------------------------------------------------------------
//                              FUNKCJE START/STOP
// ----------------------------------------------------------------------------

static void ble_config_start(void) {
    if (s_ble_is_active) return;
    ESP_LOGI(TAG, "Inicjalizacja BLE...");

    ESP_ERROR_CHECK(esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT));
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_bt_controller_init(&bt_cfg));
    ESP_ERROR_CHECK(esp_bt_controller_enable(ESP_BT_MODE_BLE));
    ESP_ERROR_CHECK(esp_bluedroid_init());
    ESP_ERROR_CHECK(esp_bluedroid_enable());
    ESP_ERROR_CHECK(esp_ble_gatts_register_callback(gatts_event_handler));
    ESP_ERROR_CHECK(esp_ble_gap_register_callback(gap_event_handler));
    ESP_ERROR_CHECK(esp_ble_gatts_app_register(0));

    s_ble_is_active = true;
    if (s_ble_timer == NULL) {
        s_ble_timer = xTimerCreate("BLE_Kill_Timer", pdMS_TO_TICKS(BLE_TIMEOUT_MS), pdFALSE, (void*)0, ble_timeout_callback);
    }
    xTimerStart(s_ble_timer, 0);
    ESP_LOGW(TAG, "BLE GOTOWE.");
}

static void ble_config_stop_internal(void) {
    if (!s_ble_is_active) return;
    ESP_LOGW(TAG, "Zatrzymywanie BLE...");
    esp_bluedroid_disable();
    esp_bluedroid_deinit();
    esp_bt_controller_disable();
    esp_bt_controller_deinit();
    s_ble_is_active = false;
    ESP_LOGI(TAG, "BLE wylaczone.");
}

static void ble_timeout_callback(TimerHandle_t xTimer) {
    ESP_LOGW(TAG, "Timeout 3 min - wylaczam BLE.");
    ble_config_stop_internal();
}

void ble_config_stop(void) {
    ble_config_stop_internal();
}

// ----------------------------------------------------------------------------
//                              TASK PRZYCISKU
// ----------------------------------------------------------------------------

static void button_task(void *pvParam) {
    // NAPRAWA: Używamy zmiennej s_btn_gpio zamiast makra BLE_CONFIG_BUTTON_GPIO
    gpio_reset_pin(s_btn_gpio);
    gpio_set_direction(s_btn_gpio, GPIO_MODE_INPUT);
    
    int hold_time = 0;
    const int interval = 100;

    while (1) {
        if (gpio_get_level(s_btn_gpio) == 0) { // wciśnięty
            hold_time += interval;
            if (hold_time % 1000 == 0 && hold_time > 0) ESP_LOGD(TAG, "Trzymam: %d", hold_time);

            if (hold_time >= BUTTON_HOLD_TIME_MS) {
                ESP_LOGI(TAG, "Przycisk 4s -> START BLE");
                
                if (!s_ble_is_active) {
                    ble_config_start(); // Teraz kompilator widzi prototyp na górze
                } else {
                    xTimerReset(s_ble_timer, 0);
                    ESP_LOGI(TAG, "Przedluzono czas BLE.");
                }

                while (gpio_get_level(s_btn_gpio) == 0) vTaskDelay(pdMS_TO_TICKS(10));
                hold_time = 0;
            }
        } else {
            hold_time = 0;
        }
        vTaskDelay(pdMS_TO_TICKS(interval));
    }
}

// NAPRAWA: Funkcja musi przyjmować argument (gpio_num_t), tak jak w pliku .h
void ble_config_init(gpio_num_t boot_btn_gpio) {
    s_btn_gpio = boot_btn_gpio; // Przypisujemy pin do zmiennej globalnej
    xTaskCreate(button_task, "ble_btn_task", 4096, NULL, 10, NULL);
}