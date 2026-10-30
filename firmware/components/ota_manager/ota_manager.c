#include "ota_manager.h"
#include "storage_manager.h"
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

// Ustawiane przez ota_task, czytane przez main (inny task)
static volatile bool s_ota_running = false;
static volatile bool s_restart_pending = false;

// Ile czasu nowy firmware ma na pierwsze polaczenie z MQTT (3 cykle po 5 min)
#define OTA_VERIFY_TIMEOUT_US (15LL * 60 * 1000 * 1000)

// Wynik ostatniego OTA - w NVS, zeby przetrwal restart (widoczny w statusie MQTT do nastepnego OTA)
#define NVS_NAMESPACE   "ota"
#define NVS_KEY_RESULT  "result"
static volatile ota_result_t s_last_result = OTA_RESULT_NONE;

static void set_result(ota_result_t result) {
    s_last_result = result;
    storage_save_i32(NVS_NAMESPACE, NVS_KEY_RESULT, (int32_t)result);
}

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
    int32_t stored = OTA_RESULT_NONE;
    storage_load_i32(NVS_NAMESPACE, NVS_KEY_RESULT, &stored, OTA_RESULT_NONE);
    s_last_result = (ota_result_t)stored;

    bool pending_verify = is_running_app_pending_verify();

    // OTA pobrane, a dzialamy na starym (potwierdzonym) obrazie = bootloader cofnal aktualizacje
    if (s_last_result == OTA_RESULT_PENDING && !pending_verify) {
        ESP_LOGW(TAG, "Poprzednie OTA zostalo cofniete (rollback) - dziala poprzedni firmware");
        set_result(OTA_RESULT_ROLLBACK);
    }

    if (!pending_verify) return; // zwykly start, nie pierwszy po OTA

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
    set_result(OTA_RESULT_OK);
    ESP_LOGI(TAG, "Nowy firmware polaczyl sie z MQTT - potwierdzony, rollback anulowany");
}

void ota_report_timeout(void) {
    set_result(OTA_RESULT_ERROR);
}

ota_result_t ota_last_result(void) {
    return s_last_result;
}

const char *ota_result_str(ota_result_t result) {
    switch (result) {
        case OTA_RESULT_PENDING:  return "pending";
        case OTA_RESULT_OK:       return "ok";
        case OTA_RESULT_ERROR:    return "error";
        case OTA_RESULT_ROLLBACK: return "rollback";
        default:                  return "none";
    }
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
        // Restart wykonuje main w bezpiecznym miejscu (nie w trakcie zapisu bufora do flasha)
        ESP_LOGI(TAG, "OTA zakonczone sukcesem - restart po zakonczeniu cyklu.");
        set_result(OTA_RESULT_PENDING); // po restarcie: ok (polaczenie z MQTT) albo rollback
        s_restart_pending = true;
    } else {
        ESP_LOGE(TAG, "Blad aktualizacji OTA: %s", esp_err_to_name(ret));
        set_result(OTA_RESULT_ERROR);
        ESP_LOGW(TAG, "Nieudane OTA - main moze wylaczyc Wi-Fi i kontynuowac pomiary.");
    }
    s_ota_running = false;

    vTaskDelete(NULL);
}

bool ota_start(const char *url) {
    if (s_ota_running) {
        ESP_LOGW(TAG, "OTA juz trwa - ignoruje kolejna komende.");
        return false;
    }
    if (strlen(url) >= sizeof(ota_url_buffer)) {
        ESP_LOGE(TAG, "URL za dlugi!");
        return false;
    }
    strcpy(ota_url_buffer, url);

    s_ota_running = true;
    if (xTaskCreate(&ota_task, "ota_task", 10240, NULL, 5, NULL) != pdPASS) {
        ESP_LOGE(TAG, "Nie udalo sie uruchomic taska OTA");
        s_ota_running = false;
        return false;
    }
    return true;
}

bool ota_is_running(void) {
    return s_ota_running;
}

bool ota_restart_pending(void) {
    return s_restart_pending;
}