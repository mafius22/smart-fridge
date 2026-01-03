#ifndef STORAGE_MANAGER_H
#define STORAGE_MANAGER_H

#include "esp_err.h"
#include <stdint.h>
#include <stddef.h>

// Inicjalizacja całego systemu NVS (wywołać raz w app_main)
esp_err_t storage_init(void);

// --- Funkcje dla liczb całkowitych (i32) ---

// Zapisuje int32 (np. licznik, flagi)
esp_err_t storage_save_i32(const char* namespace, const char* key, int32_t value);

// Odczytuje int32. Jeśli klucz nie istnieje, przypisuje default_value
esp_err_t storage_load_i32(const char* namespace, const char* key, int32_t* value, int32_t default_value);

// --- Funkcje dla ciągów znaków (string) ---

// Zapisuje string (np. SSID, token)
esp_err_t storage_save_str(const char* namespace, const char* key, const char* value);

// Odczytuje string do bufora.
// max_len: rozmiar twojego bufora
// Jeśli klucz nie istnieje, bufor zostanie pusty ("") lub skopiuje default_value
esp_err_t storage_load_str(const char* namespace, const char* key, char* buffer, size_t max_len, const char* default_value);

// --- Funkcje pomocnicze ---
esp_err_t storage_erase_key(const char* namespace, const char* key);

#endif // STORAGE_MANAGER_H