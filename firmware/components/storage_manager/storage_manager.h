#ifndef STORAGE_MANAGER_H
#define STORAGE_MANAGER_H

#include "esp_err.h"
#include <stdint.h>
#include <stddef.h>

// Inicjalizacja całego systemu NVS
esp_err_t storage_init(void);

esp_err_t storage_save_i32(const char* namespace, const char* key, int32_t value);

esp_err_t storage_load_i32(const char* namespace, const char* key, int32_t* value, int32_t default_value);

esp_err_t storage_save_str(const char* namespace, const char* key, const char* value);

esp_err_t storage_load_str(const char* namespace, const char* key, char* buffer, size_t max_len, const char* default_value);

esp_err_t storage_erase_key(const char* namespace, const char* key);

#endif // STORAGE_MANAGER_H