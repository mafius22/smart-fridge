#ifndef OFFLINE_BUFFER_H
#define OFFLINE_BUFFER_H

#include "esp_err.h"
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

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

// Maksymalna liczba rekordow w jednej paczce wysylanej z bufora
#define OFFLINE_BATCH_MAX 50

// Montuje system plikow, naprawia urwany zapis, przenosi bufor ze starszych wersji
esp_err_t offline_buffer_init(void);

// Dopisz pomiar do bufora (przy braku miejsca usuwa najstarsze ~10% danych)
esp_err_t offline_buffer_add(SensorData data);

// Liczba pomiarow czekajacych na wyslanie
size_t offline_buffer_count(void);

// Usuwa wszystkie zaleglosci (formatuje partycje) - reset fabryczny
esp_err_t offline_buffer_erase_all(void);

// Wysyla paczke rekordow. true = broker potwierdzil odbior
typedef bool (*send_batch_callback_t)(const SensorData *items, size_t count);

// Wysyla zaleglosci od najstarszych, paczkami po OFFLINE_BATCH_MAX, maks. max_records w jednym wywolaniu.
// Przy bledzie wysylki przerywa - reszta czeka na kolejny cykl.
void offline_process_queue(send_batch_callback_t send_func, size_t max_records);

#endif // OFFLINE_BUFFER_H