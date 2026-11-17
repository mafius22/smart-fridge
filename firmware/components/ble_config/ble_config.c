#include "ble_config.h"
#include "storage_manager.h"
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
#include "esp_mac.h"

#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_gap_ble_api.h"
#include "esp_gatts_api.h"
#include "esp_bt_defs.h"
#include "esp_gatt_common_api.h"

static const char *TAG = "BLE_CONFIG";

// --- KONFIGURACJA ---
#define BUTTON_HOLD_TIME_MS     4000
#define FACTORY_RESET_HOLD_MS   10000           // trzymanie BOOT 10 s + puszczenie = reset fabryczny
#define BLE_TIMEOUT_MS          (5 * 60 * 1000)
#define LED_GPIO                GPIO_NUM_2
#define LED_BLINK_MS            500
#define BLE_LOCAL_MTU           517             // telefon moze wyslac dlugi tekst jednym zapisem (bez zapisu dzielonego)

// Wymogi WPA2 i limity pol - zle dane nie sa zapisywane, telefon dostaje blad zapisu
#define SSID_MAX_LEN            32
#define PASS_MIN_LEN            8
#define PASS_MAX_LEN            63
#define MQTT_URI_MAX_LEN        128
#define MQTT_USER_MAX_LEN       64
#define MQTT_PASS_MAX_LEN       128
#define BLE_ERR_INVALID_CREDENTIALS ((esp_gatt_status_t)0x80) // kod bledu aplikacji (zakres 0x80-0x9F)

// --- UUID (FF01-FF03 bez zmian - dotychczasowa konfiguracja Wi-Fi dziala tak samo) ---
#define GATTS_SERVICE_UUID        0x00FF
#define GATTS_CHAR_UUID_SSID      0xFF01
#define GATTS_CHAR_UUID_PASS      0xFF02
#define GATTS_CHAR_UUID_ACTION    0xFF03
#define GATTS_CHAR_UUID_MQTT_URI  0xFF04
#define GATTS_CHAR_UUID_MQTT_USER 0xFF05
#define GATTS_CHAR_UUID_MQTT_PASS 0xFF06

// --- ZMIENNE GLOBALNE ---
static TimerHandle_t s_ble_timer = NULL;
static gpio_num_t s_btn_gpio = GPIO_NUM_0;
static bool s_ble_is_active = false;
static bool s_ble_connected = false;
static bool s_no_timeout = false;               // plytka nieskonfigurowana: BLE dziala az do skonfigurowania
static volatile bool s_ble_timeout_expired = false; // ustawiane przez timer, BLE wylacza task przycisku
static char s_device_name[8];                   // "SF-DF38" - koncowka MAC, rozne dla kazdej plytki
static factory_reset_cb_t s_factory_reset_cb = NULL;

static char s_wifi_ssid[SSID_MAX_LEN + 1];
static char s_wifi_pass[PASS_MAX_LEN + 1];
static char s_mqtt_uri[MQTT_URI_MAX_LEN + 1];
static char s_mqtt_user[MQTT_USER_MAX_LEN + 1];
static char s_mqtt_pass[MQTT_PASS_MAX_LEN + 1];

// Pola tekstowe: wartosc z telefonu trafia do buf (maks. max_len znakow), zapis do NVS dopiero po "Zapisz"
typedef struct {
    const char *ns;         // przestrzen NVS
    const char *key;        // klucz NVS
    char *buf;
    size_t max_len;
    uint16_t handle;        // uchwyt wartosci charakterystyki (z tabeli atrybutow)
} text_field_t;

static text_field_t s_fields[] = {
    { "wifi", "ssid", s_wifi_ssid, SSID_MAX_LEN,      0 },
    { "wifi", "pass", s_wifi_pass, PASS_MAX_LEN,      0 },
    { "mqtt", "uri",  s_mqtt_uri,  MQTT_URI_MAX_LEN,  0 },
    { "mqtt", "user", s_mqtt_user, MQTT_USER_MAX_LEN, 0 },
    { "mqtt", "pass", s_mqtt_pass, MQTT_PASS_MAX_LEN, 0 },
};
#define FIELD_COUNT (sizeof(s_fields) / sizeof(s_fields[0]))

static uint16_t s_handle_action = 0;

// Zapis dzielony (Prepare Write): dlugi tekst przychodzi kawalkami z przesunieciem, a trafia do pola
// dopiero po "Execute Write". Anulowanie albo za dlugi tekst = pole bez zmian.
static struct {
    text_field_t *field;    // pole, ktorego dotyczy trwajacy zapis dzielony (NULL = brak)
    char data[MQTT_URI_MAX_LEN + 1];
    size_t len;
    bool too_long;
} s_prep;

static void ble_timeout_callback(TimerHandle_t xTimer);
static void ble_config_start(void);
static void ble_config_stop_internal(void);

// ----------------------------------------------------------------------------
//                              TABELA ATRYBUTOW GATT
// ----------------------------------------------------------------------------

// Kolejnosc w tabeli = kolejnosc w aplikacji nRF Connect. Kazde pole: deklaracja, wartosc, opis (0x2901)
enum {
    IDX_SVC,
    IDX_SSID_DECL, IDX_SSID_VAL, IDX_SSID_DESC,
    IDX_PASS_DECL, IDX_PASS_VAL, IDX_PASS_DESC,
    IDX_URI_DECL,  IDX_URI_VAL,  IDX_URI_DESC,
    IDX_USER_DECL, IDX_USER_VAL, IDX_USER_DESC,
    IDX_MPASS_DECL, IDX_MPASS_VAL, IDX_MPASS_DESC,
    IDX_ACT_DECL,  IDX_ACT_VAL,  IDX_ACT_DESC,
    IDX_NB,
};

static const uint16_t s_uuid_primary_service = ESP_GATT_UUID_PRI_SERVICE;
static const uint16_t s_uuid_char_declare    = ESP_GATT_UUID_CHAR_DECLARE;
static const uint16_t s_uuid_char_desc       = ESP_GATT_UUID_CHAR_DESCRIPTION;
static const uint16_t s_uuid_service         = GATTS_SERVICE_UUID;
static const uint16_t s_uuid_ssid            = GATTS_CHAR_UUID_SSID;
static const uint16_t s_uuid_pass            = GATTS_CHAR_UUID_PASS;
static const uint16_t s_uuid_mqtt_uri        = GATTS_CHAR_UUID_MQTT_URI;
static const uint16_t s_uuid_mqtt_user       = GATTS_CHAR_UUID_MQTT_USER;
static const uint16_t s_uuid_mqtt_pass       = GATTS_CHAR_UUID_MQTT_PASS;
static const uint16_t s_uuid_action          = GATTS_CHAR_UUID_ACTION;
static const uint8_t  s_prop_write           = ESP_GATT_CHAR_PROP_BIT_WRITE;
static uint8_t s_empty_value[1];                 // wartosci tylko do zapisu - nic do odczytu

// Opisy widoczne w nRF Connect (bez polskich znakow - aplikacje roznie je wyswietlaja)
static const char s_desc_ssid[]      = "Wi-Fi SSID";
static const char s_desc_pass[]      = "Wi-Fi haslo";
static const char s_desc_mqtt_uri[]  = "MQTT adres";
static const char s_desc_mqtt_user[] = "MQTT login";
static const char s_desc_mqtt_pass[] = "MQTT haslo";
static const char s_desc_action[]    = "Zapisz";

// Deklaracja charakterystyki (tylko zapis) - odpowiada stos
#define CHAR_DECL() \
    { {ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&s_uuid_char_declare, ESP_GATT_PERM_READ, \
      sizeof(uint8_t), sizeof(uint8_t), (uint8_t *)&s_prop_write} }
// Wartosc charakterystyki - zapisy obsluguje aplikacja (walidacja, zapis dzielony)
#define CHAR_VAL(uuid, max) \
    { {ESP_GATT_RSP_BY_APP}, {ESP_UUID_LEN_16, (uint8_t *)&(uuid), ESP_GATT_PERM_WRITE, \
      (max), 0, s_empty_value} }
// Opis pola (Characteristic User Description, 0x2901) - odczyt obsluguje stos
#define CHAR_DESC(text) \
    { {ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&s_uuid_char_desc, ESP_GATT_PERM_READ, \
      sizeof(text) - 1, sizeof(text) - 1, (uint8_t *)(text)} }

static const esp_gatts_attr_db_t s_gatt_db[IDX_NB] = {
    [IDX_SVC] = { {ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&s_uuid_primary_service, ESP_GATT_PERM_READ,
                  sizeof(uint16_t), sizeof(s_uuid_service), (uint8_t *)&s_uuid_service} },

    [IDX_SSID_DECL]  = CHAR_DECL(),
    [IDX_SSID_VAL]   = CHAR_VAL(s_uuid_ssid, SSID_MAX_LEN),
    [IDX_SSID_DESC]  = CHAR_DESC(s_desc_ssid),

    [IDX_PASS_DECL]  = CHAR_DECL(),
    [IDX_PASS_VAL]   = CHAR_VAL(s_uuid_pass, PASS_MAX_LEN),
    [IDX_PASS_DESC]  = CHAR_DESC(s_desc_pass),

    [IDX_URI_DECL]   = CHAR_DECL(),
    [IDX_URI_VAL]    = CHAR_VAL(s_uuid_mqtt_uri, MQTT_URI_MAX_LEN),
    [IDX_URI_DESC]   = CHAR_DESC(s_desc_mqtt_uri),

    [IDX_USER_DECL]  = CHAR_DECL(),
    [IDX_USER_VAL]   = CHAR_VAL(s_uuid_mqtt_user, MQTT_USER_MAX_LEN),
    [IDX_USER_DESC]  = CHAR_DESC(s_desc_mqtt_user),

    [IDX_MPASS_DECL] = CHAR_DECL(),
    [IDX_MPASS_VAL]  = CHAR_VAL(s_uuid_mqtt_pass, MQTT_PASS_MAX_LEN),
    [IDX_MPASS_DESC] = CHAR_DESC(s_desc_mqtt_pass),

    [IDX_ACT_DECL]   = CHAR_DECL(),
    [IDX_ACT_VAL]    = CHAR_VAL(s_uuid_action, 1),
    [IDX_ACT_DESC]   = CHAR_DESC(s_desc_action),
};

// ----------------------------------------------------------------------------
//                              POLA I WALIDACJA
// ----------------------------------------------------------------------------

static text_field_t *field_by_handle(uint16_t handle) {
    for (size_t i = 0; i < FIELD_COUNT; i++) {
        if (s_fields[i].handle != 0 && s_fields[i].handle == handle) return &s_fields[i];
    }
    return NULL;
}

// Biezace wartosci z NVS - zmienia sie tylko pola wpisane w tej sesji, reszta zostaje
static void load_fields_from_nvs(void) {
    for (size_t i = 0; i < FIELD_COUNT; i++) {
        text_field_t *f = &s_fields[i];
        memset(f->buf, 0, f->max_len + 1);
        if (storage_load_str(f->ns, f->key, f->buf, f->max_len + 1, "") != ESP_OK) {
            f->buf[0] = '\0';
        }
    }
}

static bool starts_with(const char *s, const char *prefix) {
    return strncmp(s, prefix, strlen(prefix)) == 0;
}

static bool config_valid(void) {
    size_t ssid_len = strlen(s_wifi_ssid);
    size_t pass_len = strlen(s_wifi_pass);
    if (ssid_len < 1 || ssid_len > SSID_MAX_LEN) {
        ESP_LOGE(TAG, "Bledny SSID (dlugosc %u, wymagane 1-%d) - nie zapisuje", (unsigned)ssid_len, SSID_MAX_LEN);
        return false;
    }
    if (pass_len < PASS_MIN_LEN || pass_len > PASS_MAX_LEN) {
        ESP_LOGE(TAG, "Bledne haslo Wi-Fi (dlugosc %u, wymagane %d-%d) - nie zapisuje",
                 (unsigned)pass_len, PASS_MIN_LEN, PASS_MAX_LEN);
        return false;
    }
    // Adres brokera: mqtt:// (bez szyfrowania) albo mqtts:// (TLS), z nazwa hosta; port opcjonalny
    const char *host = NULL;
    if (starts_with(s_mqtt_uri, "mqtts://")) host = s_mqtt_uri + strlen("mqtts://");
    else if (starts_with(s_mqtt_uri, "mqtt://")) host = s_mqtt_uri + strlen("mqtt://");
    if (host == NULL || *host == '\0' || *host == ':' || *host == '/') {
        ESP_LOGE(TAG, "Bledny adres MQTT (wymagane mqtts://host[:port] albo mqtt://host[:port]) - nie zapisuje");
        return false;
    }
    if (strchr(s_mqtt_uri, ' ') != NULL) {
        ESP_LOGE(TAG, "Adres MQTT zawiera spacje - nie zapisuje");
        return false;
    }
    return true;
}

// Zwykly zapis: cala wartosc w jednym kawalku (offset 0) zastepuje pole
static esp_gatt_status_t write_field(text_field_t *f, const uint8_t *value, uint16_t len, uint16_t offset) {
    if (offset != 0) return ESP_GATT_INVALID_OFFSET;
    if (len > f->max_len) {
        ESP_LOGE(TAG, "Za dlugi tekst dla '%s/%s' (%u > %u) - pole bez zmian",
                 f->ns, f->key, (unsigned)len, (unsigned)f->max_len);
        return ESP_GATT_INVALID_ATTR_LEN;
    }
    memset(f->buf, 0, f->max_len + 1);
    memcpy(f->buf, value, len);
    return ESP_GATT_OK;
}

// Zapis dzielony: kolejne kawalki z przesunieciem do bufora tymczasowego
static esp_gatt_status_t prepare_field(text_field_t *f, const uint8_t *value, uint16_t len, uint16_t offset) {
    if (offset == 0 || s_prep.field != f) {
        memset(&s_prep, 0, sizeof(s_prep));
        s_prep.field = f;
    }
    if (s_prep.too_long || (size_t)offset + len > f->max_len) {
        s_prep.too_long = true;
        ESP_LOGE(TAG, "Za dlugi tekst dla '%s/%s' (ponad %u znakow) - pole bez zmian",
                 f->ns, f->key, (unsigned)f->max_len);
        return ESP_GATT_INVALID_ATTR_LEN;
    }
    memcpy(s_prep.data + offset, value, len);
    if ((size_t)offset + len > s_prep.len) s_prep.len = offset + len;
    return ESP_GATT_OK;
}

// Execute Write: zatwierdzenie (caly tekst trafia do pola) albo anulowanie
static void finish_prepared_write(bool execute) {
    text_field_t *f = s_prep.field;
    if (f != NULL && execute && !s_prep.too_long) {
        memset(f->buf, 0, f->max_len + 1);
        memcpy(f->buf, s_prep.data, s_prep.len);
        ESP_LOGI(TAG, "Zapis dzielony '%s/%s': %u znakow", f->ns, f->key, (unsigned)s_prep.len);
    } else if (f != NULL) {
        ESP_LOGW(TAG, "Zapis dzielony '%s/%s' anulowany - pole bez zmian", f->ns, f->key);
    }
    memset(&s_prep, 0, sizeof(s_prep));
}

static bool save_fields_to_nvs(void) {
    bool ok = true;
    for (size_t i = 0; i < FIELD_COUNT; i++) {
        esp_err_t err = storage_save_str(s_fields[i].ns, s_fields[i].key, s_fields[i].buf);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Zapis '%s/%s' do NVS nieudany: %s", s_fields[i].ns, s_fields[i].key, esp_err_to_name(err));
            ok = false;
        }
    }
    return ok;
}

static void send_write_response(esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t *param, esp_gatt_status_t status) {
    if (!param->write.need_rsp) return;
    esp_gatt_rsp_t *rsp = (esp_gatt_rsp_t *)calloc(1, sizeof(esp_gatt_rsp_t));
    if (rsp == NULL) return;
    // Odpowiedz na zapis dzielony musi powtorzyc otrzymany kawalek (telefon go sprawdza)
    rsp->attr_value.handle = param->write.handle;
    rsp->attr_value.offset = param->write.offset;
    rsp->attr_value.auth_req = ESP_GATT_AUTH_REQ_NONE;
    if (param->write.len > 0 && param->write.len <= sizeof(rsp->attr_value.value)) {
        rsp->attr_value.len = param->write.len;
        memcpy(rsp->attr_value.value, param->write.value, param->write.len);
    }
    esp_err_t err = esp_ble_gatts_send_response(gatts_if, param->write.conn_id, param->write.trans_id, status, rsp);
    if (err != ESP_OK) ESP_LOGE(TAG, "Send Rsp Error: %d", err);
    free(rsp);
}

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
            esp_ble_gap_set_device_name(s_device_name);
            esp_ble_gap_config_adv_data(&(esp_ble_adv_data_t){
                .set_scan_rsp = false, .include_name = true, .include_txpower = true,
                .min_interval = 0x20, .max_interval = 0x40, .appearance = 0x00,
                .flag = (ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT),
            });
            // Cala usluga (pola + opisy) jednym wywolaniem - uchwyty wracaja w ESP_GATTS_CREAT_ATTR_TAB_EVT
            esp_ble_gatts_create_attr_tab(s_gatt_db, gatts_if, IDX_NB, 0);
            break;

        case ESP_GATTS_CREAT_ATTR_TAB_EVT:
            if (param->add_attr_tab.status != ESP_GATT_OK || param->add_attr_tab.num_handle != IDX_NB) {
                ESP_LOGE(TAG, "Tworzenie uslugi BLE nieudane (status 0x%x, uchwytow %d/%d)",
                         param->add_attr_tab.status, param->add_attr_tab.num_handle, IDX_NB);
                break;
            }
            s_fields[0].handle = param->add_attr_tab.handles[IDX_SSID_VAL];
            s_fields[1].handle = param->add_attr_tab.handles[IDX_PASS_VAL];
            s_fields[2].handle = param->add_attr_tab.handles[IDX_URI_VAL];
            s_fields[3].handle = param->add_attr_tab.handles[IDX_USER_VAL];
            s_fields[4].handle = param->add_attr_tab.handles[IDX_MPASS_VAL];
            s_handle_action = param->add_attr_tab.handles[IDX_ACT_VAL];
            esp_ble_gatts_start_service(param->add_attr_tab.handles[IDX_SVC]);
            ESP_LOGI(TAG, "Usluga BLE gotowa (%d atrybutow)", IDX_NB);
            break;

        case ESP_GATTS_WRITE_EVT: {
            // Bez wypisywania wartosci - to moga byc hasla
            ESP_LOGI(TAG, "WRITE: hnd %d, len %d, prep %d, off %d",
                     param->write.handle, param->write.len, param->write.is_prep, param->write.offset);
            if (s_ble_timer) xTimerReset(s_ble_timer, 0);

            esp_gatt_status_t status = ESP_GATT_OK;
            bool save_ok = false;
            text_field_t *field = field_by_handle(param->write.handle);

            if (field != NULL) {
                status = param->write.is_prep
                    ? prepare_field(field, param->write.value, param->write.len, param->write.offset)
                    : write_field(field, param->write.value, param->write.len, param->write.offset);
            } else if (param->write.handle == s_handle_action && !param->write.is_prep) {
                // "1" = zapisz. Sprawdzamy dane przed odpowiedzia, zeby telefon dostal blad przy zlych danych
                if (param->write.len > 0 && param->write.value[0] == '1') {
                    save_ok = config_valid();
                    if (!save_ok) status = BLE_ERR_INVALID_CREDENTIALS;
                }
            }

            send_write_response(gatts_if, param, status);

            if (save_ok) {
                ESP_LOGW(TAG, "ZAPIS I RESTART...");
                if (!save_fields_to_nvs()) {
                    ESP_LOGE(TAG, "Nie wszystkie dane zapisane - sprawdz konfiguracje po restarcie");
                }
                vTaskDelay(pdMS_TO_TICKS(500));
                esp_restart();
            }
            break;
        }

        case ESP_GATTS_EXEC_WRITE_EVT:
            finish_prepared_write(param->exec_write.exec_write_flag == ESP_GATT_PREP_WRITE_EXEC);
            esp_ble_gatts_send_response(gatts_if, param->exec_write.conn_id, param->exec_write.trans_id, ESP_GATT_OK, NULL);
            break;

        case ESP_GATTS_CONNECT_EVT:
            ESP_LOGI(TAG, "CONNECTED");
            s_ble_connected = true;
            memset(&s_prep, 0, sizeof(s_prep));
            if (s_ble_timer) xTimerReset(s_ble_timer, 0);
            break;

        case ESP_GATTS_DISCONNECT_EVT:
            ESP_LOGI(TAG, "DISCONNECTED");
            s_ble_connected = false;
            memset(&s_prep, 0, sizeof(s_prep)); // przerwany zapis dzielony nie trafia do pola
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
    // Zapisane wartosci jako punkt wyjscia - telefon zmienia tylko wpisane pola
    load_fields_from_nvs();
    memset(&s_prep, 0, sizeof(s_prep));

    ESP_ERROR_CHECK(esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT));
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_bt_controller_init(&bt_cfg));
    ESP_ERROR_CHECK(esp_bt_controller_enable(ESP_BT_MODE_BLE));
    ESP_ERROR_CHECK(esp_bluedroid_init());
    ESP_ERROR_CHECK(esp_bluedroid_enable());
    ESP_ERROR_CHECK(esp_ble_gatts_register_callback(gatts_event_handler));
    ESP_ERROR_CHECK(esp_ble_gap_register_callback(gap_event_handler));
    ESP_ERROR_CHECK(esp_ble_gatts_app_register(0));
    // Wieksze MTU: dlugi tekst (adres brokera, haslo) jednym zapisem, gdy telefon to obsluguje
    esp_err_t mtu_err = esp_ble_gatt_set_local_mtu(BLE_LOCAL_MTU);
    if (mtu_err != ESP_OK) ESP_LOGW(TAG, "Nie ustawiono MTU %d: %s", BLE_LOCAL_MTU, esp_err_to_name(mtu_err));

    s_ble_is_active = true;
    if (s_no_timeout) {
        ESP_LOGW(TAG, "BLE GOTOWE jako %s (bez limitu czasu - czekam na konfiguracje Wi-Fi i MQTT).", s_device_name);
        return;
    }
    if (s_ble_timer == NULL) {
        s_ble_timer = xTimerCreate("BLE_Kill_Timer", pdMS_TO_TICKS(BLE_TIMEOUT_MS), pdFALSE, (void*)0, ble_timeout_callback);
    }
    xTimerStart(s_ble_timer, 0);
    ESP_LOGW(TAG, "BLE GOTOWE jako %s.", s_device_name);
}

static void ble_config_stop_internal(void) {
    if (!s_ble_is_active) return;
    ESP_LOGW(TAG, "Zatrzymywanie BLE...");
    esp_bluedroid_disable();
    esp_bluedroid_deinit();
    esp_bt_controller_disable();
    esp_bt_controller_deinit();
    s_ble_is_active = false;
    s_ble_connected = false;
    for (size_t i = 0; i < FIELD_COUNT; i++) memset(s_fields[i].buf, 0, s_fields[i].max_len + 1);
    memset(&s_prep, 0, sizeof(s_prep));
    ESP_LOGI(TAG, "BLE wylaczone.");
}

// Dziala w tasku Timer Service (stos 2 KB, wspolny dla wszystkich timerow) - wylaczanie Bluetooth
// jest tam za ciezkie, wiec tylko ustawiamy flage dla taska przycisku
static void ble_timeout_callback(TimerHandle_t xTimer) {
    s_ble_timeout_expired = true;
}

void ble_config_stop(void) {
    ble_config_stop_internal();
}

// ----------------------------------------------------------------------------
//                              TASK PRZYCISKU
// ----------------------------------------------------------------------------

static void button_task(void *pvParam) {
    gpio_reset_pin(s_btn_gpio);
    gpio_set_direction(s_btn_gpio, GPIO_MODE_INPUT);

    gpio_reset_pin(LED_GPIO);
    gpio_set_direction(LED_GPIO, GPIO_MODE_OUTPUT);
    gpio_set_level(LED_GPIO, 0);

    int hold_time = 0;
    const int interval = 100;
    int led_ticks = 0;
    bool led_on = false;
    bool ble_triggered = false;   // 4 s: BLE wlaczone w tym przytrzymaniu
    bool reset_armed = false;     // 10 s: puszczenie przycisku = reset fabryczny

    while (1) {
        if (s_ble_timeout_expired) {
            s_ble_timeout_expired = false;
            ESP_LOGW(TAG, "Timeout 5 min - wylaczam BLE.");
            ble_config_stop_internal();
        }

        if (gpio_get_level(s_btn_gpio) == 0) {
            hold_time += interval;
            if (hold_time % 1000 == 0) ESP_LOGD(TAG, "Trzymam: %d", hold_time);

            if (hold_time >= BUTTON_HOLD_TIME_MS && !ble_triggered) {
                ble_triggered = true;
                ESP_LOGI(TAG, "Przycisk 4s -> START BLE");

                if (!s_ble_is_active) {
                    ble_config_start();
                    led_on = true;
                    led_ticks = 0;
                } else if (s_ble_timer) {
                    xTimerReset(s_ble_timer, 0);
                    ESP_LOGI(TAG, "Przedluzono czas BLE.");
                }
            }

            if (hold_time >= FACTORY_RESET_HOLD_MS && !reset_armed) {
                reset_armed = true;
                ESP_LOGW(TAG, "Przycisk 10s - pusc, aby wykonac RESET FABRYCZNY");
            }
        } else {
            if (reset_armed && s_factory_reset_cb) {
                ESP_LOGW(TAG, "RESET FABRYCZNY");
                gpio_set_level(LED_GPIO, 1);
                s_factory_reset_cb(); // czysci dane i restartuje plytke - nie wraca
            }
            hold_time = 0;
            ble_triggered = false;
            reset_armed = false;
        }

        // Dioda: szybko miga = reset fabryczny po puszczeniu, miga = rozglaszanie,
        // swieci = telefon polaczony, zgaszona = BLE wylaczone
        if (reset_armed) {
            led_on = !led_on;
        } else if (s_ble_is_active && !s_ble_connected) {
            if (++led_ticks >= LED_BLINK_MS / interval) {
                led_ticks = 0;
                led_on = !led_on;
            }
        } else {
            led_ticks = 0;
            led_on = s_ble_is_active;
        }
        gpio_set_level(LED_GPIO, led_on);

        vTaskDelay(pdMS_TO_TICKS(interval));
    }
}

void ble_config_init(gpio_num_t boot_btn_gpio, bool start_now, factory_reset_cb_t factory_reset_cb) {
    s_btn_gpio = boot_btn_gpio;
    s_factory_reset_cb = factory_reset_cb;

    // Nazwa z koncowki MAC - przy kilku plytkach wiadomo, z ktora sie laczymy
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(s_device_name, sizeof(s_device_name), "SF-%02X%02X", mac[4], mac[5]);

    if (start_now) {
        // Plytka nieskonfigurowana (brak Wi-Fi albo brokera MQTT - nowa / po resecie fabrycznym): BLE od razu,
        // az do skonfigurowania
        s_no_timeout = true;
        ble_config_start();
    }
    xTaskCreate(button_task, "ble_btn_task", 4096, NULL, 10, NULL);
}