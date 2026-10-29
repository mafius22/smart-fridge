#ifndef OFFLINE_BUFFER_H
#define OFFLINE_BUFFER_H

#include "esp_err.h"
#include <stdint.h>
#include <stdbool.h>

// Struktura pojedynczego pomiaru
typedef struct {
    int64_t timestamp;   // Unix timestamp
    uint64_t sensor_rom; // 64-bitowy adres ROM czujnika DS18B20
    float temp;          // -127.0 = blad odczytu
} SensorData;

// Dlugosc tekstu z adresem ROM: 16 znakow hex + '\0'
#define SENSOR_ROM_STR_LEN 17

// Zamienia adres ROM na tekst, np. "28ff4a1b0c160354"
void sensor_rom_to_str(uint64_t rom, char *out);

// Montuje system plików
esp_err_t offline_buffer_init(void);

// Dopisz pomiar na koniec pliku
esp_err_t offline_buffer_add(SensorData data);

// Sprawdź ile mamy pomiarów w buforze
size_t offline_buffer_count(void);

// Typ funkcji callback - użyjemy jej do wysyłania danych
// Zwraca true jeśli wysyłka się udała, false jeśli błąd
typedef bool (*send_data_callback_t)(SensorData data);

// Przetwórz bufor: Czyta dane, wywołuje callback, 
// i jeśli sukces - usuwa dane z pliku.
void offline_process_queue(send_data_callback_t send_func);

#endif // OFFLINE_BUFFER_H