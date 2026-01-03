#include "mqtt_handler.h"
#include "mqtt_client.h"
#include "esp_log.h"
#include "freertos/event_groups.h"

static const char *TAG = "MQTT_HANDLER";

// --- KONFIGURACJA BROKERA (Możesz zmienić na swój) ---
#define MQTT_BROKER_URI "mqtt://broker.hivemq.com"
#define MQTT_TOPIC      "esp32/smartfridge/data"

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
            ESP_LOGI(TAG, "MQTT Polaczono!");
            xEventGroupSetBits(s_mqtt_event_group, MQTT_CONNECTED_BIT);
            break;
            
        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGI(TAG, "MQTT Rozlaczono.");
            // Jeśli rozłączyło nas w trakcie pracy, to błąd
            // (chyba że sami wywołaliśmy stop, ale to obsłużymy w funkcji stop)
            break;

        case MQTT_EVENT_PUBLISHED:
            ESP_LOGD(TAG, "Wiadomosc ID=%d opublikowana", event->msg_id);
            xEventGroupSetBits(s_mqtt_event_group, MQTT_PUBLISHED_BIT);
            break;

        case MQTT_EVENT_ERROR:
            ESP_LOGE(TAG, "MQTT ERROR");
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
        .session.keepalive = 60,
        .network.timeout_ms = 10000,
    };

    client = esp_mqtt_client_init(&mqtt_cfg);
    if (client == NULL) return false;

    esp_mqtt_client_register_event(client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    esp_mqtt_client_start(client);

    // Czekaj na połączenie (max 10 sekund)
    EventBits_t bits = xEventGroupWaitBits(s_mqtt_event_group, 
        MQTT_CONNECTED_BIT | MQTT_FAIL_BIT, 
        pdFALSE, pdFALSE, pdMS_TO_TICKS(10000));

    if (bits & MQTT_CONNECTED_BIT) {
        return true;
    } else {
        ESP_LOGE(TAG, "Nie udalo sie polaczyc z brokerem MQTT.");
        mqtt_app_stop(); // Sprzątanko
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

    // Tworzenie JSONa ręcznie (sprintf jest lżejszy niż cJSON dla prostych danych)
    char payload[128];
    snprintf(payload, sizeof(payload), 
             "{\"ts\":%lld, \"temp\":%.2f, \"press\":%lu}", 
             data.timestamp, data.temp, data.pressure);

    // Czyścimy flagę wysłania przed publikacją
    xEventGroupClearBits(s_mqtt_event_group, MQTT_PUBLISHED_BIT);

    // Publikacja (QoS 1 - gwarancja dostarczenia)
    int msg_id = esp_mqtt_client_publish(client, MQTT_TOPIC, payload, 0, 1, 0);
    
    if (msg_id == -1) {
        ESP_LOGE(TAG, "Blad kolejkowania wiadomosci");
        return false;
    }

    // Czekamy na potwierdzenie od brokera (PUBACK), że odebrał
    // To ważne, bo zaraz wyłączamy WiFi!
    EventBits_t bits = xEventGroupWaitBits(s_mqtt_event_group, 
        MQTT_PUBLISHED_BIT, 
        pdTRUE, pdFALSE, pdMS_TO_TICKS(5000));

    if (bits & MQTT_PUBLISHED_BIT) {
        ESP_LOGI(TAG, "Wyslano: %s", payload);
        return true;
    } else {
        ESP_LOGE(TAG, "Timeout potwierdzenia wysylki (PUBACK brak)");
        return false;
    }
}