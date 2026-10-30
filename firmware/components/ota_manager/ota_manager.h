#pragma once

#include <stdbool.h>

// Startuje pobieranie w osobnym tasku. false = OTA juz trwa albo bledny URL
bool ota_start(const char *url);

// true od startu OTA do jego zakonczenia (sukces lub blad) - main nie wylacza wtedy Wi-Fi
bool ota_is_running(void);

// true po udanym OTA - restart do nowego firmware wykonuje main
bool ota_restart_pending(void);

// Wywolac na starcie: jesli to pierwszy start po OTA, nowy firmware ma 15 min
// na polaczenie z MQTT, inaczej powrot do poprzedniego
void ota_rollback_guard_start(void);

// Wywolac po udanym polaczeniu z MQTT: potwierdza nowy firmware po OTA
void ota_confirm_app_valid(void);
