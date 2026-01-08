#include "mqtt_handler.h"
#include "mqtt_client.h"
#include "esp_log.h"
#include "freertos/event_groups.h"
#include "esp_crt_bundle.h"

static const char *TAG = "MQTT_HANDLER";

// Pobieramy konfigurację z Kconfig (menuconfig)
#define MQTT_BROKER_URI     CONFIG_HIVE_MQTT_BROKER_URI
#define MQTT_USERNAME       CONFIG_HIVE_MQTT_USERNAME
#define MQTT_PASSWORD       CONFIG_HIVE_MQTT_PASSWORD
#define MQTT_TOPIC          CONFIG_HIVE_MQTT_TOPIC

// Flagi zdarzeń
static EventGroupHandle_t s_mqtt_event_group;
#define MQTT_CONNECTED_BIT  BIT0
#define MQTT_PUBLISHED_BIT  BIT1
#define MQTT_FAIL_BIT       BIT2

static esp_mqtt_client_handle_t client = NULL;

// Callback obsługujący zdarzenia MQTT
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
                ESP_LOGE(TAG, "Last error code reported from esp-tls: 0x%x", event->error_handle->esp_tls_last_esp_err);
                ESP_LOGE(TAG, "Last tls stack error number: 0x%x", event->error_handle->esp_tls_stack_err);
                ESP_LOGE(TAG, "Last captured errno : %d (%s)",  event->error_handle->esp_transport_sock_errno,
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
        .broker.address.port = 8883, // Standardowy port dla SSL/MQTTS
        
        // Logowanie (dane z Kconfig)
        .credentials.username = MQTT_USERNAME,
        .credentials.authentication.password = MQTT_PASSWORD,

        // SSL / TLS - Używamy wbudowanego w ESP zestawu certyfikatów (najprostsza metoda dla HiveMQ)
        .broker.verification.crt_bundle_attach = esp_crt_bundle_attach,

        .session.keepalive = 60,
        .network.timeout_ms = 15000, // Zwiększony timeout dla SSL
    };

    client = esp_mqtt_client_init(&mqtt_cfg);
    if (client == NULL) return false;

    esp_mqtt_client_register_event(client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    esp_mqtt_client_start(client);

    // Czekaj na połączenie (max 15 sekund dla SSL)
    EventBits_t bits = xEventGroupWaitBits(s_mqtt_event_group, 
        MQTT_CONNECTED_BIT | MQTT_FAIL_BIT, 
        pdFALSE, pdFALSE, pdMS_TO_TICKS(15000));

    if (bits & MQTT_CONNECTED_BIT) {
        return true;
    } else {
        ESP_LOGE(TAG, "Nie udalo sie polaczyc z HiveMQ.");
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

    char payload[128];
    // JSON: {"ts": 123456789, "temp": 25.5, "press": 0}
    snprintf(payload, sizeof(payload), 
             "{\"ts\":%lld, \"temp\":%.2f, \"press\":%lu}", 
             data.timestamp, data.temp, data.pressure);

    xEventGroupClearBits(s_mqtt_event_group, MQTT_PUBLISHED_BIT);

    // Publikacja do tematu zdefiniowanego w Kconfig
    int msg_id = esp_mqtt_client_publish(client, MQTT_TOPIC, payload, 0, 1, 0);
    
    if (msg_id == -1) {
        ESP_LOGE(TAG, "Blad kolejkowania wiadomosci");
        return false;
    }

    // Czekamy na potwierdzenie (PUBACK)
    EventBits_t bits = xEventGroupWaitBits(s_mqtt_event_group, 
        MQTT_PUBLISHED_BIT, 
        pdTRUE, pdFALSE, pdMS_TO_TICKS(5000));

    if (bits & MQTT_PUBLISHED_BIT) {
        ESP_LOGI(TAG, "Wyslano na %s: %s", MQTT_TOPIC, payload);
        return true;
    } else {
        ESP_LOGE(TAG, "Timeout potwierdzenia wysylki");
        return false;
    }
}