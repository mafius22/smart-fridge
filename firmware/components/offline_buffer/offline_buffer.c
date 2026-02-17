#include "offline_buffer.h"
#include "esp_spiffs.h"
#include "esp_log.h"
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *TAG = "OFFLINE_BUF";
static const char *FILE_PATH = "/storage/data.bin";

esp_err_t offline_buffer_init(void) {
    esp_vfs_spiffs_conf_t conf = {
      .base_path = "/storage",
      .partition_label = "storage",
      .max_files = 5,
      .format_if_mount_failed = true
    };

    esp_err_t ret = esp_vfs_spiffs_register(&conf);

    if (ret != ESP_OK) {
        if (ret == ESP_FAIL) {
            ESP_LOGE(TAG, "Failed to mount or format filesystem");
        } else if (ret == ESP_ERR_NOT_FOUND) {
            ESP_LOGE(TAG, "Failed to find SPIFFS partition");
        } else {
            ESP_LOGE(TAG, "Failed to initialize SPIFFS (%s)", esp_err_to_name(ret));
        }
        return ret;
    }

    size_t total = 0, used = 0;
    ret = esp_spiffs_info(conf.partition_label, &total, &used);
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "Partition size: total: %d, used: %d", total, used);
    }
    return ESP_OK;
}

esp_err_t offline_buffer_add(SensorData data) {
    FILE* f = fopen(FILE_PATH, "ab");
    if (f == NULL) {
        ESP_LOGE(TAG, "Failed to open file for writing");
        return ESP_FAIL;
    }
    
    fwrite(&data, sizeof(SensorData), 1, f);
    fclose(f);
    
    ESP_LOGI(TAG, "Zapisano offline [TS:%lld]: T:%.2f C, P:%lu Pa", data.timestamp, data.temp, data.pressure);
    return ESP_OK;
}

size_t offline_buffer_count(void) {
    struct stat st;
    if (stat(FILE_PATH, &st) != 0) {
        return 0; // Plik nie istnieje
    }
    return st.st_size / sizeof(SensorData);
}

void offline_process_queue(send_data_callback_t send_func) {
    const char *TEMP_PATH = "/storage/processing.bin";
    
    struct stat st;
    if (stat(FILE_PATH, &st) != 0 || st.st_size == 0) {
        return; // Pusto
    }

    ESP_LOGI(TAG, "Przetwarzanie bufora offline (%ld bajtow)...", st.st_size);

    rename(FILE_PATH, TEMP_PATH);

    FILE* f_temp = fopen(TEMP_PATH, "rb");
    if (f_temp == NULL) return;

    SensorData d;
    bool sending_failed = false;
    
    while (fread(&d, sizeof(SensorData), 1, f_temp)) {
        if (!sending_failed) {
            bool success = send_func(d);
            if (!success) {
                sending_failed = true;
                ESP_LOGW(TAG, "Wysylka nieudana, zachowuje reszte danych...");
            }
        }

        if (sending_failed) {
            offline_buffer_add(d); 
        } else {
            ESP_LOGI(TAG, "Rekord z %lld wyslany!", d.timestamp);
        }
    }

    fclose(f_temp);
    
    unlink(TEMP_PATH);
}