#include "offline_buffer.h"
#include "esp_spiffs.h"
#include "esp_log.h"
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *TAG = "OFFLINE_BUF";
// Rekord zawiera ROM czujnika zamiast jego numeru - nowe pliki, zeby nie czytac starego formatu
static const char *FILE_PATH = "/storage/buf_v2.bin";
static const char *TEMP_PATH = "/storage/buf_v2_tmp.bin";

// Pliki bufora w starym formacie (sensor_id = numer z kolejnosci wykrycia)
static const char *OLD_FILE_PATH = "/storage/data.bin";
static const char *OLD_TEMP_PATH = "/storage/processing.bin";

void sensor_rom_to_str(uint64_t rom, char *out) {
    // Bajty w kolejnosci nadawania na magistrali: kod rodziny (0x28) pierwszy, CRC ostatni
    for (int i = 0; i < 8; i++) {
        sprintf(out + i * 2, "%02x", (unsigned)((rom >> (8 * i)) & 0xFF));
    }
}

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

    // Starego formatu nie da sie poprawnie odczytac - usuwamy
    bool old_data = (unlink(OLD_FILE_PATH) == 0);
    bool old_temp = (unlink(OLD_TEMP_PATH) == 0);
    if (old_data || old_temp) {
        ESP_LOGW(TAG, "Usunieto bufor w starym formacie");
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
    
    char rom_str[SENSOR_ROM_STR_LEN];
    sensor_rom_to_str(data.sensor_rom, rom_str);
    ESP_LOGI(TAG, "Zapisano offline [TS:%lld] [%s]: T:%.2f C", data.timestamp, rom_str, data.temp);
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