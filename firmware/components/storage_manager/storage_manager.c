#include "storage_manager.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "STORAGE";

esp_err_t storage_init(void) {
    esp_err_t err = nvs_flash_init();
    
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "NVS partition truncated or different version. Erasing...");
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "NVS Initialized");
    } else {
        ESP_LOGE(TAG, "NVS Init failed: %s", esp_err_to_name(err));
    }
    
    return err;
}

static esp_err_t _open_nvs(const char* namespace, nvs_open_mode_t mode, nvs_handle_t *handle) {
    esp_err_t err = nvs_open(namespace, mode, handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS namespace '%s': %s", namespace, esp_err_to_name(err));
    }
    return err;
}

esp_err_t storage_save_i32(const char* namespace, const char* key, int32_t value) {
    nvs_handle_t handle;
    esp_err_t err = _open_nvs(namespace, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;

    err = nvs_set_i32(handle, key, value);
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    
    nvs_close(handle);
    return err;
}

esp_err_t storage_load_i32(const char* namespace, const char* key, int32_t* value, int32_t default_value) {
    nvs_handle_t handle;
    esp_err_t err = _open_nvs(namespace, NVS_READONLY, &handle);
    
    if (err != ESP_OK) {
        *value = default_value;
        return err;
    }

    err = nvs_get_i32(handle, key, value);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        *value = default_value;
        ESP_LOGI(TAG, "Key '%s' not found in '%s', using default", key, namespace);
        err = ESP_OK;
    }
    
    nvs_close(handle);
    return err;
}

esp_err_t storage_save_str(const char* namespace, const char* key, const char* value) {
    nvs_handle_t handle;
    esp_err_t err = _open_nvs(namespace, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;

    err = nvs_set_str(handle, key, value);
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }

    nvs_close(handle);
    return err;
}

esp_err_t storage_load_str(const char* namespace, const char* key, char* buffer, size_t max_len, const char* default_value) {
    nvs_handle_t handle;
    esp_err_t err = _open_nvs(namespace, NVS_READONLY, &handle);
    
    if (err != ESP_OK) {
        if (default_value != NULL) {
            strncpy(buffer, default_value, max_len - 1);
            buffer[max_len - 1] = '\0';
        }
        return err;
    }

    size_t required_size;
    err = nvs_get_str(handle, key, NULL, &required_size);

    if (err == ESP_OK) {
        if (required_size <= max_len) {
            err = nvs_get_str(handle, key, buffer, &required_size);
        } else {
            ESP_LOGE(TAG, "Buffer too small for key '%s'. Needed: %d", key, required_size);
            err = ESP_ERR_NVS_INVALID_LENGTH;
        }
    } else if (err == ESP_ERR_NVS_NOT_FOUND) {
        if (default_value != NULL) {
            strncpy(buffer, default_value, max_len - 1);
            buffer[max_len - 1] = '\0';
        }
        err = ESP_OK; 
    }

    nvs_close(handle);
    return err;
}

esp_err_t storage_erase_key(const char* namespace, const char* key) {
    nvs_handle_t handle;
    esp_err_t err = _open_nvs(namespace, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;

    err = nvs_erase_key(handle, key);
    if (err == ESP_OK) {
        nvs_commit(handle);
    }
    
    nvs_close(handle);
    return err;
}