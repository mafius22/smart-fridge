#include "mqtt_handler.h"
#include "mqtt_client.h"
#include "esp_log.h"
#include "freertos/event_groups.h"
#include "esp_crt_bundle.h"
#include "offline_buffer.h" 
#include <string.h>
#include "esp_system.h" 
#include "ota_manager.h" 
#include <stdbool.h>

static const char *TAG = "MQTT_HANDLER";

// Zmienna globalna do blokowania Deep Sleep w main.c
extern bool g_ota_trwa;

// Deklaracja zapowiadająca (forward declaration)
void mqtt_app_stop(void);

// Pobieramy konfigurację z Kconfig
#define MQTT_BROKER_URI     CONFIG_HIVE_MQTT_BROKER_URI
#define MQTT_USERNAME       CONFIG_HIVE_MQTT_USERNAME
#define MQTT_PASSWORD       CONFIG_HIVE_MQTT_PASSWORD
#define MQTT_TOPIC_BASE     CONFIG_HIVE_MQTT_TOPIC 

#define MQTT_TOPIC_RESET    "esp32/reset" 
#define MQTT_TOPIC_UPDATE   "esp32/update" 

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
            
            esp_mqtt_client_subscribe(client, MQTT_TOPIC_RESET, 0);
            esp_mqtt_client_subscribe(client, MQTT_TOPIC_UPDATE, 0);
            
            ESP_LOGI(TAG, "Zasubskrybowano tematy: %s oraz %s", MQTT_TOPIC_RESET, MQTT_TOPIC_UPDATE);
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
            if (strncmp(event->topic, MQTT_TOPIC_RESET, event->topic_len) == 0) {
                if (strncmp(event->data, "1", event->data_len) == 0) {
                    ESP_LOGW(TAG, "!!! KOMENDA RESETU !!!");
                    esp_mqtt_client_publish(client, MQTT_TOPIC_RESET, "", 0, 1, 1); // Czyść temat
                    vTaskDelay(pdMS_TO_TICKS(2000));
                    esp_restart();
                }
            }
            
            // --- OBSŁUGA OTA (AKTUALIZACJI) ---
            else if (strncmp(event->topic, MQTT_TOPIC_UPDATE, event->topic_len) == 0) {
                
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

                // 3. BLOKADA DEEP SLEEP
                g_ota_trwa = true; 
                ESP_LOGW(TAG, "Ustawiono flage g_ota_trwa = true. Blokuje usypianie.");
                
                // 4. CZYŚCIMY TEMAT (Retain)
                // To wyśle pustą wiadomość, która wróci do nas, ale "if" na górze ją zablokuje
                esp_mqtt_client_publish(client, MQTT_TOPIC_UPDATE, "", 0, 1, 1);
                
                // 5. START OTA
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

    const esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = MQTT_BROKER_URI,
        .broker.address.port = 8883,
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

    const char *topic_config = CONFIG_HIVE_MQTT_TOPIC; 
    char dynamic_topic[128];
    char *last_slash = strrchr(topic_config, '/');

    // Budowanie tematu: jesli konczy sie slashem lub nie
    if (last_slash != NULL) {
        int prefix_len = last_slash - topic_config;
        snprintf(dynamic_topic, sizeof(dynamic_topic), "%.*s%d%s", 
                 prefix_len, topic_config, data.sensor_id, last_slash);
    } else {
        snprintf(dynamic_topic, sizeof(dynamic_topic), "%s%d", topic_config, data.sensor_id);
    }

    char payload[128];
    // JSON Payload
    snprintf(payload, sizeof(payload), 
             "{\"id\":%d, \"ts\":%lld, \"temp\":%.2f, \"press\":%lu}", 
             data.sensor_id, data.timestamp, data.temp, (unsigned long)data.pressure);

    xEventGroupClearBits(s_mqtt_event_group, MQTT_PUBLISHED_BIT);

    int msg_id = esp_mqtt_client_publish(client, dynamic_topic, payload, 0, 1, 0);
    
    if (msg_id == -1) {
        ESP_LOGE(TAG, "Blad kolejkowania wiadomosci");
        return false;
    }

    EventBits_t bits = xEventGroupWaitBits(s_mqtt_event_group, 
        MQTT_PUBLISHED_BIT, 
        pdTRUE, pdFALSE, pdMS_TO_TICKS(5000));

    if (bits & MQTT_PUBLISHED_BIT) {
        ESP_LOGI(TAG, "Wyslano na [%s]: %s", dynamic_topic, payload);
        return true;
    } else {
        ESP_LOGE(TAG, "Timeout potwierdzenia wysylki");
        return false;
    }
}