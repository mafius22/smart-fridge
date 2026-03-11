#include "ota_manager.h"
#include "esp_log.h"
#include "esp_http_client.h"
#include "esp_https_ota.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>
#include "esp_crt_bundle.h"
#include <stdbool.h>

static const char *TAG = "OTA_MANAGER";
static char ota_url_buffer[256];

extern bool g_ota_trwa; 

void ota_task(void *pvParameter) {
    ESP_LOGI(TAG, "Rozpoczynam OTA z URL: %s", ota_url_buffer);

    esp_http_client_config_t config = {
        .url = ota_url_buffer,
        .timeout_ms = 10000,
        .keep_alive_enable = true,
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
        ESP_LOGW(TAG, "Zwolniono blokade Deep Sleep po nieudanym OTA.");
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