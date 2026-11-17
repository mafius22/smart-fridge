#pragma once

#include <stdbool.h>

// Wynik ostatniej aktualizacji (zapisany w NVS, raportowany w statusie MQTT)
typedef enum {
    OTA_RESULT_NONE = 0,  // nie bylo OTA
    OTA_RESULT_PENDING,   // obraz pobrany, czeka na restart i potwierdzenie
    OTA_RESULT_OK,        // nowy firmware dziala (polaczyl sie z MQTT)
    OTA_RESULT_ERROR,     // pobieranie nieudane albo trwalo za dlugo
    OTA_RESULT_ROLLBACK,  // nowy firmware nie dzialal - bootloader wrocil do poprzedniego
} ota_result_t;

// Startuje pobieranie w osobnym tasku. false = OTA juz trwa albo bledny URL
bool ota_start(const char *url);

// true od startu OTA do jego zakonczenia (sukces lub blad) - main nie wylacza wtedy Wi-Fi
bool ota_is_running(void);

// true po udanym OTA - restart do nowego firmware wykonuje main
bool ota_restart_pending(void);

// Wywolac na starcie (po storage_init): odczytuje wynik ostatniego OTA i wykrywa rollback.
// Jesli to pierwszy start po OTA, nowy firmware ma 15 min na polaczenie z MQTT, inaczej powrot do poprzedniego
void ota_rollback_guard_start(void);

// Wywolac po udanym polaczeniu z MQTT: potwierdza nowy firmware po OTA
void ota_confirm_app_valid(void);

// OTA przerwane przez main (trwalo za dlugo) - zapisuje blad przed restartem
void ota_report_timeout(void);

ota_result_t ota_last_result(void);
const char *ota_result_str(ota_result_t result);
