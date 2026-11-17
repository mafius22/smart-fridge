#include "wifi_connect.h"
#include "storage_manager.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include <string.h>

static const char *TAG = "WIFI_CONN";

#define MAX_RETRY         3

static EventGroupHandle_t s_wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

static int s_retry_num = 0;
static bool s_is_connected = false;
static bool s_allow_reconnect = true;
static bool s_has_credentials = false; // SSID zapisany przez BLE (nowa plytka / po resecie fabrycznym = brak)

static void event_handler(void* arg, esp_event_base_t event_base,
                                int32_t event_id, void* event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } 
    else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        s_is_connected = false;
        
        if (s_allow_reconnect) {
            if (s_retry_num < MAX_RETRY) {
                esp_wifi_connect();
                s_retry_num++;
                ESP_LOGW(TAG, "Utrata polaczenia WiFi. Ponawiam... (%d/%d)", s_retry_num, MAX_RETRY);
            } else {
                xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
            }
        }
    } 
    else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        s_retry_num = 0;
        s_is_connected = true;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

void wifi_connect_init(void) {
    if (s_wifi_event_group == NULL) {
        s_wifi_event_group = xEventGroupCreate();
    }
    
    ESP_ERROR_CHECK(esp_netif_init());
    
    
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL, &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL, &instance_got_ip));

    wifi_config_t wifi_config = {0};
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    
    storage_load_str("wifi", "ssid", (char*)wifi_config.sta.ssid, sizeof(wifi_config.sta.ssid), "");
    storage_load_str("wifi", "pass", (char*)wifi_config.sta.password, sizeof(wifi_config.sta.password), "");
    s_has_credentials = (wifi_config.sta.ssid[0] != '\0');

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));

    if (s_has_credentials) {
        // Bez zapisanej sieci nie ustawiamy pustej konfiguracji - radio i tak nie jest wlaczane
        ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
        ESP_LOGI(TAG, "WiFi zainicjalizowane (Radio wylaczone).");
    } else {
        ESP_LOGW(TAG, "Brak zapisanej sieci Wi-Fi - skonfiguruj przez BLE.");
    }
}

bool wifi_has_credentials(void) {
    return s_has_credentials;
}

esp_err_t wifi_connect_start(void) {
    s_retry_num = 0;
    s_allow_reconnect = true;

    if (s_wifi_event_group == NULL) return ESP_FAIL;
    if (!s_has_credentials) {
        ESP_LOGW(TAG, "Brak konfiguracji Wi-Fi - pomijam laczenie.");
        return ESP_FAIL;
    }

    xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT | WIFI_FAIL_BIT);
    
    ESP_LOGI(TAG, "Wlaczam WiFi...");
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Czekam na polaczenie (max 10s)...");

    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
            WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
            pdFALSE, pdFALSE, pdMS_TO_TICKS(10000));

    if (bits & WIFI_CONNECTED_BIT) {
        // Dostep do internetu sprawdza polaczenie z brokerem MQTT (brak = pomiary do bufora)
        ESP_LOGI(TAG, "Polaczono z routerem.");
        return ESP_OK;
    } else {
        if (bits & WIFI_FAIL_BIT) {
             ESP_LOGE(TAG, "Nie udalo sie polaczyc (bledne haslo/brak zasiegu).");
        } else {
             ESP_LOGE(TAG, "TIMEOUT: Router nie odpowiada.");
        }
        
        wifi_connect_stop();
        return ESP_FAIL;
    }
}

void wifi_connect_stop(void) {
    s_allow_reconnect = false; 
    s_is_connected = false;
    
    ESP_LOGI(TAG, "Wylaczam WiFi...");
    esp_wifi_stop(); 
}

bool wifi_is_connected(void) {
    return s_is_connected;
}