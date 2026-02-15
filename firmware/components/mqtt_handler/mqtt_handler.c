#include "mqtt_handler.h"
#include "mqtt_client.h"
#include "esp_log.h"
#include "freertos/event_groups.h"
#include "esp_crt_bundle.h"
#include "offline_buffer.h" 
#include <string.h>

static const char *TAG = "MQTT_HANDLER";

// Pobieramy konfigurację z Kconfig
#define MQTT_BROKER_URI     CONFIG_HIVE_MQTT_BROKER_URI
#define MQTT_USERNAME       CONFIG_HIVE_MQTT_USERNAME
#define MQTT_PASSWORD       CONFIG_HIVE_MQTT_PASSWORD
#define MQTT_TOPIC_BASE     CONFIG_HIVE_MQTT_TOPIC 

// Flagi zdarzeń
static EventGroupHandle_t s_mqtt_event_group;
#define MQTT_CONNECTED_BIT  BIT0
#define MQTT_PUBLISHED_BIT  BIT1
#define MQTT_FAIL_BIT       BIT2

static esp_mqtt_client_handle_t client = NULL;

static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data) {
    esp_mqtt_event_handle_t event = event_data;
    
    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "MQTT Polaczono z: %s", MQTT_BROKER_URI);
            xEventGroupSetBits(s_mqtt_event_group, MQTT_CONNECTED_BIT);
            break;
            
        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGI(TAG, "MQTT Rozlaczono.");
            break;

        case MQTT_EVENT_PUBLISHED:
            ESP_LOGD(TAG, "Wiadomosc ID=%d opublikowana", event->msg_id);
            xEventGroupSetBits(s_mqtt_event_group, MQTT_PUBLISHED_BIT);
            break;

        case MQTT_EVENT_ERROR:
            ESP_LOGE(TAG, "MQTT ERROR");
            if (event->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) {
                ESP_LOGE(TAG, "Last error code: 0x%x", event->error_handle->esp_tls_last_esp_err);
                ESP_LOGE(TAG, "Last tls stack error: 0x%x", event->error_handle->esp_tls_stack_err);
                ESP_LOGE(TAG, "Last errno: %d (%s)",  event->error_handle->esp_transport_sock_errno,
                         strerror(event->error_handle->esp_transport_sock_errno));
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

    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = MQTT_BROKER_URI,
        .broker.address.port = 8883,
        .credentials.username = MQTT_USERNAME,
        .credentials.authentication.password = MQTT_PASSWORD,
        .broker.verification.crt_bundle_attach = esp_crt_bundle_attach,
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

// --- TU JEST GŁÓWNA ZMIANA ---
bool mqtt_send_sensor_data(SensorData data) {
    if (client == NULL) return false;

    // Pobieramy string z konfiguracji: "esp32/smartfridge/mielecDom/data"
    const char *topic_config = CONFIG_HIVE_MQTT_TOPIC; 
    
    char dynamic_topic[128];
    
    // Szukamy ostatniego wystąpienia znaku '/'
    char *last_slash = strrchr(topic_config, '/');

    if (last_slash != NULL) {
        // Obliczamy długość części przed ostatnim ukośnikiem
        // Dla ".../mielecDom/data" będzie to długość ".../mielecDom"
        int prefix_len = last_slash - topic_config;

        /*
           Budujemy nowy temat:
           1. %.*s -> Wypisz 'prefix_len' znaków ze stringa (czyli: esp32/smartfridge/mielecDom)
           2. %d   -> Wstaw ID czujnika (czyli: 0)
           3. %s   -> Wypisz resztę od ostatniego ukośnika (czyli: /data)
        */
        snprintf(dynamic_topic, sizeof(dynamic_topic), "%.*s%d%s", 
                 prefix_len, topic_config, data.sensor_id, last_slash);
    } else {
        // Zabezpieczenie: Jeśli w configu nie ma ukośników, po prostu doklejamy ID na koniec
        snprintf(dynamic_topic, sizeof(dynamic_topic), "%s%d", topic_config, data.sensor_id);
    }

    // --- Reszta funkcji bez zmian ---
    char payload[128];
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