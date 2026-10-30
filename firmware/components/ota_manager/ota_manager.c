#include "ota_manager.h"
#include "esp_log.h"
#include "esp_http_client.h"
#include "esp_https_ota.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>
#include "esp_crt_bundle.h"
#include "esp_ota_ops.h"
#include "esp_timer.h"
#include <stdbool.h>

static const char *TAG = "OTA_MANAGER";
static char ota_url_buffer[256];

extern bool g_ota_trwa;

// Ile czasu nowy firmware ma na pierwsze polaczenie z MQTT (3 cykle po 5 min)
#define OTA_VERIFY_TIMEOUT_US (15LL * 60 * 1000 * 1000)

static bool is_running_app_pending_verify(void) {
    esp_ota_img_states_t state;
    const esp_partition_t *running = esp_ota_get_running_partition();
    return esp_ota_get_state_partition(running, &state) == ESP_OK && state == ESP_OTA_IMG_PENDING_VERIFY;
}

static void verify_timeout_cb(void *arg) {
    if (is_running_app_pending_verify()) {
        ESP_LOGE(TAG, "Nowy firmware nie polaczyl sie z MQTT w 15 min - wracam do poprzedniego");
        esp_ota_mark_app_invalid_rollback_and_reboot();
    }
}

void ota_rollback_guard_start(void) {
    if (!is_running_app_pending_verify()) return; // zwykly start, nie pierwszy po OTA

    ESP_LOGW(TAG, "Pierwszy start po OTA - czekam na polaczenie z MQTT (max 15 min)");
    const esp_timer_create_args_t args = {
        .callback = verify_timeout_cb,
        .name = "ota_verify",
    };
    esp_timer_handle_t timer;
    if (esp_timer_create(&args, &timer) == ESP_OK) {
        esp_timer_start_once(timer, OTA_VERIFY_TIMEOUT_US);
    }
}

void ota_confirm_app_valid(void) {
    if (!is_running_app_pending_verify()) return;

    esp_ota_mark_app_valid_cancel_rollback();
    ESP_LOGI(TAG, "Nowy firmware polaczyl sie z MQTT - potwierdzony, rollback anulowany");
}

void ota_task(void *pvParameter) {
    ESP_LOGI(TAG, "Rozpoczynam OTA z URL: %s", ota_url_buffer);

    esp_http_client_config_t config = {
        .url = ota_url_buffer,
        .timeout_ms = 10000,
        .keep_alive_enable = true,
        // GitHub odpowiada przekierowaniem z dlugim (~800 znakow) podpisanym adresem w naglowku Location.
        // Domyslne 512 B to za malo ("Out of buffer"); wiekszy bufor przyspiesza tez pobieranie obrazu
        .buffer_size = 4096,
        .buffer_size_tx = 2048,
        .skip_cert_common_name_check = true,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };

    esp_https_ota_config_t ota_config = {
        .http_config = &config,
    };

    esp_err_t ret = esp_https_ota(&ota_config);
    
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "OTA zakonczone sukcesem! Restart...");
        vTaskDelay(pdMS_TO_TICKS(1000));
        esp_restart();
    } else {
        ESP_LOGE(TAG, "Blad aktualizacji OTA: %s", esp_err_to_name(ret));
        
        g_ota_trwa = false; 
        ESP_LOGW(TAG, "Nieudane OTA - main moze wylaczyc Wi-Fi i kontynuowac pomiary.");
    }
    
    vTaskDelete(NULL);
}

void ota_start(const char *url) {
    if (strlen(url) >= sizeof(ota_url_buffer)) {
        ESP_LOGE(TAG, "URL za dlugi!");
        g_ota_trwa = false; 
        return;
    }
    strcpy(ota_url_buffer, url);
    
    xTaskCreate(&ota_task, "ota_task", 10240, NULL, 5, NULL);
}