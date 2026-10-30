#include "mqtt_handler.h"
#include "mqtt_client.h"
#include "esp_log.h"
#include "freertos/event_groups.h"
#include "esp_crt_bundle.h"
#include "offline_buffer.h" 
#include <string.h>
#include "esp_system.h"
#include "esp_mac.h"
#include "ota_manager.h"
#include <stdbool.h>

static const char *TAG = "MQTT_HANDLER";

// Komenda reset odebrana - restart wykonuje main po zakonczeniu cyklu
static volatile bool s_restart_requested = false;

// Deklaracja zapowiadająca (forward declaration)
void mqtt_app_stop(void);

// Pobieramy konfigurację z Kconfig
#define MQTT_BROKER_URI     CONFIG_HIVE_MQTT_BROKER_URI
#define MQTT_USERNAME       CONFIG_HIVE_MQTT_USERNAME
#define MQTT_PASSWORD       CONFIG_HIVE_MQTT_PASSWORD

#define MQTT_TOPIC_PREFIX   "sf/v1"

// Nazwa plytki z adresu MAC
static char s_device_id[16];
static char s_topic_data[64];   // sf/v1/{id}/data   - pomiary
static char s_topic_reset[64];  // sf/v1/{id}/reset  - "1" = restart
static char s_topic_update[64]; // sf/v1/{id}/update - link do OTA

static void init_device_topics(void) {
    if (s_device_id[0] != '\0') return; // juz policzone

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(s_device_id, sizeof(s_device_id), "sf-%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    snprintf(s_topic_data, sizeof(s_topic_data), MQTT_TOPIC_PREFIX "/%s/data", s_device_id);
    snprintf(s_topic_reset, sizeof(s_topic_reset), MQTT_TOPIC_PREFIX "/%s/reset", s_device_id);
    snprintf(s_topic_update, sizeof(s_topic_update), MQTT_TOPIC_PREFIX "/%s/update", s_device_id);

    ESP_LOGI(TAG, "ID plytki: %s", s_device_id);
}

// Dokladne porownanie tematu (event->topic nie jest zakonczony zerem)
static bool topic_is(esp_mqtt_event_handle_t event, const char *topic) {
    return event->topic_len == (int)strlen(topic) && memcmp(event->topic, topic, event->topic_len) == 0;
}

// Flagi zdarzeń
static EventGroupHandle_t s_mqtt_event_group;
#define MQTT_CONNECTED_BIT  BIT0
#define MQTT_PUBLISHED_BIT  BIT1
#define MQTT_FAIL_BIT       BIT2

static esp_mqtt_client_handle_t client = NULL;

static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data) {
    esp_mqtt_event_handle_t event = event_data;
    esp_mqtt_client_handle_t client = event->client;
    
    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "MQTT Polaczono z: %s", MQTT_BROKER_URI);
            xEventGroupSetBits(s_mqtt_event_group, MQTT_CONNECTED_BIT);

            // Polaczenie dziala - nowy firmware po OTA moze odbierac kolejne aktualizacje
            ota_confirm_app_valid();

            esp_mqtt_client_subscribe(client, s_topic_reset, 0);
            esp_mqtt_client_subscribe(client, s_topic_update, 0);

            ESP_LOGI(TAG, "Zasubskrybowano tematy: %s oraz %s", s_topic_reset, s_topic_update);
            break;
            
        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGI(TAG, "MQTT Rozlaczono.");
            break;

        case MQTT_EVENT_PUBLISHED:
            ESP_LOGD(TAG, "Wiadomosc ID=%d opublikowana", event->msg_id);
            xEventGroupSetBits(s_mqtt_event_group, MQTT_PUBLISHED_BIT);
            break;

        case MQTT_EVENT_DATA:
            ESP_LOGI(TAG, "Odebrano na temat: %.*s", event->topic_len, event->topic);

            // --- OBSŁUGA RESETU ---
            if (topic_is(event, s_topic_reset)) {
                // Pusta wiadomosc (czyszczenie retain) nie moze wywolac restartu
                if (event->data_len == 1 && event->data[0] == '1') {
                    ESP_LOGW(TAG, "!!! KOMENDA RESETU !!! Restart po zakonczeniu cyklu.");
                    esp_mqtt_client_publish(client, s_topic_reset, "", 0, 1, 1); // Czyść temat
                    s_restart_requested = true;
                }
            }
            
            // --- OBSŁUGA OTA (AKTUALIZACJI) ---
            else if (topic_is(event, s_topic_update)) {
                
                // 1. OCHRONA PRZED PĘTLĄ: Ignoruj puste wiadomości (czyszczące)
                if (event->data_len < 10) {
                    ESP_LOGD(TAG, "Ignoruje pusty payload (czyszczenie retain)");
                    return; 
                }

                char url[256];

                // 2. ZABEZPIECZENIE BUFORA
                if (event->data_len >= sizeof(url)) {
                    ESP_LOGE(TAG, "Link OTA jest za dlugi! Max %d znakow.", sizeof(url) - 1);
                    return;
                }

                // Kopiowanie danych do stringa (bezpieczne)
                memcpy(url, event->data, event->data_len);
                url[event->data_len] = '\0'; // Konieczny null-terminator!
                
                ESP_LOGW(TAG, "Otrzymano link OTA: %s", url);

                // 3. CZYŚCIMY TEMAT (Retain)
                // To wyśle pustą wiadomość, która wróci do nas, ale "if" na górze ją zablokuje
                esp_mqtt_client_publish(client, s_topic_update, "", 0, 1, 1);

                // 4. START OTA (main nie wylaczy Wi-Fi, dopoki ota_is_running())
                ota_start(url);
            }
            break;

        case MQTT_EVENT_ERROR:
            ESP_LOGE(TAG, "MQTT ERROR");
            if (event->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) {
                // log error specifics if needed
            }
            xEventGroupSetBits(s_mqtt_event_group, MQTT_FAIL_BIT);
            break;
            
        default:
            break;
    }
}

bool mqtt_app_start(void) {
    if (s_mqtt_event_group == NULL) {
        s_mqtt_event_group = xEventGroupCreate();
    }
    xEventGroupClearBits(s_mqtt_event_group, MQTT_CONNECTED_BIT | MQTT_FAIL_BIT);

    init_device_topics();

    const esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = MQTT_BROKER_URI,
        .broker.address.port = 8883,
        .credentials.client_id = s_device_id,
        .credentials.username = MQTT_USERNAME,
        .credentials.authentication.password = MQTT_PASSWORD,
        .broker.verification.crt_bundle_attach = esp_crt_bundle_attach, // Certyfikaty Vercel/SSL
        .session.keepalive = 60,
        .network.timeout_ms = 15000,
    };

    client = esp_mqtt_client_init(&mqtt_cfg);
    if (client == NULL) return false;

    esp_mqtt_client_register_event(client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    esp_mqtt_client_start(client);

    EventBits_t bits = xEventGroupWaitBits(s_mqtt_event_group, 
        MQTT_CONNECTED_BIT | MQTT_FAIL_BIT, 
        pdFALSE, pdFALSE, pdMS_TO_TICKS(15000));

    if (bits & MQTT_CONNECTED_BIT) {
        return true;
    } else {
        ESP_LOGE(TAG, "Nie udalo sie polaczyc z MQTT.");
        mqtt_app_stop(); 
        return false;
    }
}

void mqtt_app_stop(void) {
    if (client != NULL) {
        esp_mqtt_client_stop(client);
        esp_mqtt_client_destroy(client);
        client = NULL;
    }
}

bool mqtt_send_sensor_data(SensorData data) {
    if (client == NULL) return false;

    char rom_str[SENSOR_ROM_STR_LEN];
    sensor_rom_to_str(data.sensor_rom, rom_str);

    char payload[128];
    // JSON Payload: czujnik rozpoznawany po ROM, plytka po temacie
    snprintf(payload, sizeof(payload),
             "{\"sid\":\"%s\",\"ts\":%lld,\"temp\":%.2f}",
             rom_str, data.timestamp, data.temp);

    xEventGroupClearBits(s_mqtt_event_group, MQTT_PUBLISHED_BIT);

    int msg_id = esp_mqtt_client_publish(client, s_topic_data, payload, 0, 1, 0);
    
    if (msg_id == -1) {
        ESP_LOGE(TAG, "Blad kolejkowania wiadomosci");
        return false;
    }

    EventBits_t bits = xEventGroupWaitBits(s_mqtt_event_group, 
        MQTT_PUBLISHED_BIT, 
        pdTRUE, pdFALSE, pdMS_TO_TICKS(5000));

    if (bits & MQTT_PUBLISHED_BIT) {
        ESP_LOGI(TAG, "Wyslano na [%s]: %s", s_topic_data, payload);
        return true;
    } else {
        ESP_LOGE(TAG, "Timeout potwierdzenia wysylki");
        return false;
    }
}

bool mqtt_restart_requested(void) {
    return s_restart_requested;
}