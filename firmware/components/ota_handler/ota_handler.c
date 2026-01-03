#include "ota_handler.h"
#include "esp_log.h"
#include "esp_http_client.h"
#include "esp_https_ota.h"
#include "esp_crt_bundle.h"

static const char *TAG = "OTA_HANDLER";

esp_err_t start_ota_update(const char *url) {
    ESP_LOGW(TAG, "Rozpoczynanie OTA z URL: %s", url);

    esp_http_client_config_t config = {
        .url = url,
        .crt_bundle_attach = esp_crt_bundle_attach, // Pozwala ufać publicznym certyfikatom SSL
        .keep_alive_enable = true,
        .timeout_ms = 10000,
    };

    esp_https_ota_config_t ota_config = {
        .http_config = &config,
    };

    ESP_LOGI(TAG, "Pobieranie i wgrywanie firmware... To moze potrwac.");
    
    esp_err_t ret = esp_https_ota(&ota_config);
    
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "OTA Sukces! Restartowanie systemu...");
        esp_restart();
    } else {
        ESP_LOGE(TAG, "OTA Blad: %s", esp_err_to_name(ret));
    }
    return ret;
}