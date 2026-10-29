#pragma once

void ota_start(const char *url);

// Wywolac na starcie: jesli to pierwszy start po OTA, nowy firmware ma 15 min
// na polaczenie z MQTT, inaczej powrot do poprzedniego
void ota_rollback_guard_start(void);

// Wywolac po udanym polaczeniu z MQTT: potwierdza nowy firmware po OTA
void ota_confirm_app_valid(void);
