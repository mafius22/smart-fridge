#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "nvs_flash.h"
// Dołączamy tylko gotowe moduły (BEZ OTA)
#include "storage_manager.h"
#include "offline_buffer.h"
#include "wifi_connect.h"
#include "ble_config.h"

static const char *TAG = "TEST_SYSTEM";

// --- KONFIGURACJA TESTOWA (ZMIEŃ TO!) ---
#define TEST_WIFI_SSID  "Matić"
#define TEST_WIFI_PASS  "21152115"

// Symulacja wysyłania do chmury (zwraca true = sukces)
bool mock_send_to_cloud(SensorData data) {
    // Tutaj normalnie byłby kod MQTT lub HTTP POST
    ESP_LOGI("CLOUD", ">>> WYSYŁKA SKUTECZNA: Czas: %lld, Temp: %.2f, Wilg: %.2f", 
             data.timestamp, data.temp, data.humidity);
    
    // Symulujemy małe opóźnienie sieci
    vTaskDelay(pdMS_TO_TICKS(50)); 
    return true; 
}

// Funkcja generująca sztuczne dane z czujnika
SensorData get_sensor_reading(int counter) {
    SensorData d;
    d.timestamp = esp_timer_get_time() / 1000000; // Czas w sekundach od startu
    d.temp = 4.0 + (counter * 0.1);    // Symulacja temperatury w lodówce
    d.humidity = 80.0 + (counter % 5); // Symulacja wilgotności
    return d;
}

void app_main(void) {
    // ====================================================
    // 1. INICJALIZACJA (Wykonuje się RAZ po starcie)
    // ====================================================
    ESP_LOGI(TAG, "--- START SYSTEMU ---");
    
    ESP_ERROR_CHECK(storage_init());
    
    // System plików (Bufor Offline)
    if (offline_buffer_init() != ESP_OK) {
        ESP_LOGE(TAG, "Blad montowania SPIFFS! (Moze trwa formatowanie?)");
    }


    // Sterowniki WiFi (tylko ładuje sterownik, nie łączy jeszcze!)
    wifi_connect_init();

    ble_config_init();

    ESP_LOGI(TAG, "Inicjalizacja gotowa. Rozpoczynam petle pracy...");
    vTaskDelay(pdMS_TO_TICKS(1000));

    int cycle_counter = 0;

    // ====================================================
    // 2. PĘTLA GŁÓWNA (Cykl życia urządzenia)
    // ====================================================
    while (1) {
        cycle_counter++;
        ESP_LOGI(TAG, "\n--- CYKL #%d ---", cycle_counter);

        // KROK A: Pobranie pomiaru
        SensorData current_data = get_sensor_reading(cycle_counter);
        ESP_LOGI(TAG, "Odczyt czujnika: Temp=%.2fC", current_data.temp);

        // KROK B: Włączenie WiFi i próba połączenia
        ESP_LOGI(TAG, "[WiFi] Wlaczam radio i lacze...");
        esp_err_t wifi_status = wifi_connect_start(); // To blokuje program aż połączy lub timeout

        if (wifi_status == ESP_OK) {
            // >>> SCENARIUSZ ONLINE <<<
            ESP_LOGI(TAG, "[SYSTEM] Jestem ONLINE!");

            // 1. Sprawdź, czy mamy coś w buforze z przeszłości
            size_t buffered_count = offline_buffer_count();
            if (buffered_count > 0) {
                ESP_LOGI(TAG, "[BUFFER] Wykryto %d zaleglych pomiarow. Wysylam...", buffered_count);
                // Ta funkcja wyśle wszystko z pliku używając naszej funkcji mock_send_to_cloud
                offline_process_queue(mock_send_to_cloud);
            } else {
                ESP_LOGI(TAG, "[BUFFER] Czysto. Brak zaleglosci.");
            }

            // 2. Wyślij bieżący pomiar
            ESP_LOGI(TAG, "[CLOUD] Wysylam biezacy pomiar...");
            mock_send_to_cloud(current_data);

        } else {
            // >>> SCENARIUSZ OFFLINE <<<
            ESP_LOGW(TAG, "[SYSTEM] BRAK INTERNETU! (Router wylaczony?)");
            
            // Zapisz bieżący pomiar do pliku
            ESP_LOGI(TAG, "[BUFFER] Zapisuje pomiar do pamieci Flash.");
            offline_buffer_add(current_data);
        }

        // KROK C: Wyłączenie WiFi (Oszczędzanie energii)
        ESP_LOGI(TAG, "[WiFi] Wylaczam radio.");
        wifi_connect_stop();

        // KROK D: Czekanie (Symulacja 5 minut - tu 10 sekund dla testu)
        ESP_LOGI(TAG, "[SLEEP] Czekam 10 sekund do nastepnego cyklu...");
        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}