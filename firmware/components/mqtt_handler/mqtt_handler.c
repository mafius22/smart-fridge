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
static char s_topic_status[64]; // sf/v1/{id}/status - stan plytki (retained)

static void init_device_topics(void) {
    if (s_device_id[0] != '\0') return; // juz policzone

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(s_device_id, sizeof(s_device_id), "sf-%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    snprintf(s_topic_data, sizeof(s_topic_data), MQTT_TOPIC_PREFIX "/%s/data", s_device_id);
    snprintf(s_topic_reset, sizeof(s_topic_reset), MQTT_TOPIC_PREFIX "/%s/reset", s_device_id);
    snprintf(s_topic_update, sizeof(s_topic_update), MQTT_TOPIC_PREFIX "/%s/update", s_device_id);
    snprintf(s_topic_status, sizeof(s_topic_status), MQTT_TOPIC_PREFIX "/%s/status", s_device_id);

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

// msg_id ostatniej potwierdzonej (PUBACK) wiadomosci - spozniony PUBACK poprzedniej nie zatwierdzi nowej paczki
static volatile int s_acked_msg_id = -1;

// Paczka pomiarow w JSON: ~60 B na rekord x OFFLINE_BATCH_MAX (50) + naglowek
#define PAYLOAD_MAX       4096
#define PUBACK_TIMEOUT_MS 10000
static char s_payload[PAYLOAD_MAX];

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
            s_acked_msg_id = event->msg_id;
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
        .buffer.out_size = PAYLOAD_MAX, // paczka pomiarow w jednym kawalku (domyslnie 1024 B)
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

// Buduje {"readings":[{"sid":...,"ts":...,"temp":...},...]} - czujnik po ROM, plytka po temacie
static bool build_readings_payload(const SensorData *items, size_t count) {
    size_t len = snprintf(s_payload, PAYLOAD_MAX, "{\"readings\":[");
    for (size_t i = 0; i < count; i++) {
        char rom_str[SENSOR_ROM_STR_LEN];
        sensor_rom_to_str(items[i].sensor_rom, rom_str);
        len += snprintf(s_payload + len, PAYLOAD_MAX - len, "%s{\"sid\":\"%s\",\"ts\":%lld,\"temp\":%.2f}",
                        (i > 0) ? "," : "", rom_str, items[i].timestamp, items[i].temp);
        if (len >= PAYLOAD_MAX) {
            return false;
        }
    }
    len += snprintf(s_payload + len, PAYLOAD_MAX - len, "]}");
    return len < PAYLOAD_MAX;
}

// Publikacja QoS1 i czekanie na PUBACK wlasnie tej wiadomosci. true = broker potwierdzil odbior
static bool publish_and_wait(const char *topic, const char *payload, bool retain) {
    if (client == NULL) return false;

    xEventGroupClearBits(s_mqtt_event_group, MQTT_PUBLISHED_BIT);

    int msg_id = esp_mqtt_client_publish(client, topic, payload, 0, 1, retain ? 1 : 0);
    if (msg_id == -1) {
        ESP_LOGE(TAG, "Blad kolejkowania wiadomosci na [%s]", topic);
        return false;
    }

    const TickType_t timeout = pdMS_TO_TICKS(PUBACK_TIMEOUT_MS);
    const TickType_t start = xTaskGetTickCount();
    TickType_t elapsed;
    while ((elapsed = xTaskGetTickCount() - start) < timeout) {
        xEventGroupWaitBits(s_mqtt_event_group, MQTT_PUBLISHED_BIT, pdTRUE, pdFALSE, timeout - elapsed);
        if (s_acked_msg_id == msg_id) {
            return true;
        }
    }
    ESP_LOGE(TAG, "Timeout potwierdzenia wysylki na [%s]", topic);
    return false;
}

bool mqtt_send_readings(const SensorData *items, size_t count) {
    if (count == 0) return false;

    if (!build_readings_payload(items, count)) {
        ESP_LOGE(TAG, "Paczka %u pomiarow nie miesci sie w %d B", (unsigned)count, PAYLOAD_MAX);
        return false;
    }
    if (!publish_and_wait(s_topic_data, s_payload, false)) {
        return false;
    }
    ESP_LOGI(TAG, "Wyslano %u pomiarow na [%s]", (unsigned)count, s_topic_data);
    return true;
}

bool mqtt_publish_status(const char *json) {
    // Retained: backend po restarcie od razu dostaje ostatni status kazdej plytki
    if (!publish_and_wait(s_topic_status, json, true)) {
        return false;
    }
    ESP_LOGI(TAG, "Status na [%s]: %s", s_topic_status, json);
    return true;
}

bool mqtt_restart_requested(void) {
    return s_restart_requested;
}