#ifndef OFFLINE_BUFFER_H
#define OFFLINE_BUFFER_H

#include "esp_err.h"
#include <stdint.h>
#include <stdbool.h>

// Struktura pojedynczego pomiaru
typedef struct {
    int64_t timestamp; // Czas pomiaru (Unix timestamp)
    float temp;
    uint32_t pressure;
    int sensor_id;
} SensorData;

// Montuje system plików (wywołaj raz w app_main)
esp_err_t offline_buffer_init(void);

// Dopisz pomiar na koniec pliku (gdy brak sieci)
esp_err_t offline_buffer_add(SensorData data);

// Sprawdź ile mamy pomiarów w buforze
size_t offline_buffer_count(void);

// Typ funkcji callback - użyjemy jej do wysyłania danych
// Zwraca true jeśli wysyłka się udała, false jeśli błąd
typedef bool (*send_data_callback_t)(SensorData data);

// Przetwórz bufor: Czyta dane, wywołuje callback (wysyłkę), 
// i jeśli sukces - usuwa dane z pliku.
void offline_process_queue(send_data_callback_t send_func);

#endif // OFFLINE_BUFFER_H