#include "offline_buffer.h"
#include "storage_manager.h"
#include "esp_spiffs.h"
#include "esp_log.h"
#include <stdio.h>
#include <string.h>
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *TAG = "OFFLINE_BUF";

#define BASE_PATH        "/storage"
#define PARTITION_LABEL  "storage"

// Bufor = ciag plikow seg_00001.bin, seg_00002.bin... (najstarszy -> najnowszy).
// Male pliki pozwalaja usunac najstarsze dane jednym unlink - bez kopiowania, ktore przy pelnej partycji jest niemozliwe.
#define SEG_PREFIX       "seg_"
#define SEG_RECORDS      500   // 500 x 24 B = 12 KB na segment
#define MIN_FREE_PERCENT 10    // SPIFFS potrzebuje wolnego miejsca na porzadki - prawie pelny zwalnia i odrzuca zapisy
#define DROP_PERCENT     10    // przy braku miejsca usuwamy ~10% najstarszych danych

// Ile rekordow z najstarszego segmentu juz wyslano - przetrwa restart w trakcie wysylki
#define NVS_NAMESPACE    "buf"
#define NVS_KEY_SENT     "sent"

// Do bufora trafiaja tylko pomiary z wazna godzina (po 2024-01-01)
#define MIN_VALID_TS     1704067200

// Bufor z poprzedniej wersji firmware (jeden plik) - przenoszony do segmentow przy starcie
static const char *LEGACY_PATHS[] = { BASE_PATH "/buf_v2_tmp.bin", BASE_PATH "/buf_v2.bin" };

// Pliki bufora w starym formacie (sensor_id = numer z kolejnosci wykrycia)
static const char *OLD_FILE_PATH = BASE_PATH "/data.bin";
static const char *OLD_TEMP_PATH = BASE_PATH "/processing.bin";

static uint32_t s_first_seg = 0;  // najstarszy segment, 0 = bufor pusty
static uint32_t s_last_seg = 0;   // najnowszy segment - do niego dopisujemy
static uint32_t s_sent = 0;       // rekordy z najstarszego segmentu juz wyslane
static SensorData s_batch[OFFLINE_BATCH_MAX];

void sensor_rom_to_str(uint64_t rom, char *out) {
    // Bajty w kolejnosci nadawania na magistrali: kod rodziny (0x28) pierwszy, CRC ostatni
    for (int i = 0; i < 8; i++) {
        sprintf(out + i * 2, "%02x", (unsigned)((rom >> (8 * i)) & 0xFF));
    }
}

static void seg_path(uint32_t seg, char *out, size_t len) {
    snprintf(out, len, BASE_PATH "/" SEG_PREFIX "%05lu.bin", (unsigned long)seg);
}

static size_t seg_records(uint32_t seg) {
    char path[32];
    struct stat st;
    seg_path(seg, path, sizeof(path));
    if (stat(path, &st) != 0) {
        return 0;
    }
    return st.st_size / sizeof(SensorData);
}

static void save_sent(void) {
    storage_save_i32(NVS_NAMESPACE, NVS_KEY_SENT, (int32_t)s_sent);
}

// Odrzuca tylko rekordy niemozliwe fizycznie (smieci po urwanym zapisie). -127 = awaria czujnika - zostaje.
static bool record_is_valid(const SensorData *d) {
    bool rom_ok = (d->sensor_rom & 0xFF) == 0x28;
    bool ts_ok = d->timestamp > MIN_VALID_TS;
    bool temp_ok = d->temp == -127.0f || (d->temp > -60.0f && d->temp < 130.0f);
    return rom_ok && ts_ok && temp_ok;
}

// Zanik pradu w trakcie zapisu moze zostawic urwany rekord na koncu pliku.
// Ucinamy go, zeby kolejne dopisane rekordy nie byly przesuniete.
static void align_segment(uint32_t seg) {
    char path[32];
    struct stat st;
    seg_path(seg, path, sizeof(path));
    if (stat(path, &st) != 0) {
        return;
    }
    off_t aligned = (st.st_size / sizeof(SensorData)) * sizeof(SensorData);
    if (aligned != st.st_size) {
        ESP_LOGW(TAG, "Urwany rekord w %s (%ld B) - ucinam do %ld B", path, (long)st.st_size, (long)aligned);
        truncate(path, aligned);
    }
}

// Usuwa najstarszy segment: wyslany w calosci albo przy braku miejsca
static void drop_oldest_segment(void) {
    char path[32];
    seg_path(s_first_seg, path, sizeof(path));
    unlink(path);

    if (s_first_seg == s_last_seg) {
        s_first_seg = 0;
        s_last_seg = 0;
    } else {
        s_first_seg++;
    }
    if (s_sent != 0) {
        s_sent = 0;
        save_sent();
    }
}

static void ensure_free_space(void) {
    size_t total = 0, used = 0;
    if (esp_spiffs_info(PARTITION_LABEL, &total, &used) != ESP_OK || total == 0) {
        return;
    }
    if ((total - used) * 100 >= total * MIN_FREE_PERCENT) {
        return;
    }

    uint32_t segs = (s_first_seg == 0) ? 0 : s_last_seg - s_first_seg + 1;
    uint32_t to_drop = (segs * DROP_PERCENT + 99) / 100;   // zaokraglenie w gore - min. 1 segment
    if (to_drop >= segs) {
        to_drop = (segs > 1) ? segs - 1 : 0;                // najnowszy segment zostaje - do niego dopisujemy
    }
    if (to_drop == 0) {
        return;
    }

    ESP_LOGW(TAG, "Malo miejsca (zajete %u z %u B) - usuwam %lu najstarszych segmentow (~%lu pomiarow)",
             (unsigned)used, (unsigned)total, (unsigned long)to_drop, (unsigned long)(to_drop * SEG_RECORDS));
    for (uint32_t i = 0; i < to_drop; i++) {
        drop_oldest_segment();
    }
}

static esp_err_t append_record(const SensorData *data) {
    ensure_free_space();

    // Nowy segment, gdy bufor pusty albo najnowszy segment pelny
    if (s_first_seg == 0) {
        s_first_seg = s_last_seg = s_last_seg + 1;
    } else if (seg_records(s_last_seg) >= SEG_RECORDS) {
        s_last_seg++;
    }

    char path[32];
    seg_path(s_last_seg, path, sizeof(path));
    FILE *f = fopen(path, "ab");
    if (f == NULL) {
        ESP_LOGE(TAG, "Nie mozna otworzyc %s do zapisu", path);
        return ESP_FAIL;
    }
    size_t written = fwrite(data, sizeof(SensorData), 1, f);
    int closed = fclose(f);

    if (written != 1 || closed != 0) {
        ESP_LOGE(TAG, "Blad zapisu do %s - pomiar utracony", path);
        align_segment(s_last_seg); // czesciowy zapis przesunalby kolejne rekordy
        return ESP_FAIL;
    }
    return ESP_OK;
}

// Rekordy z poprzedniej wersji firmware (jeden plik bufora) przenosimy do segmentow
static void migrate_legacy_buffer(void) {
    for (size_t i = 0; i < sizeof(LEGACY_PATHS) / sizeof(LEGACY_PATHS[0]); i++) {
        FILE *f = fopen(LEGACY_PATHS[i], "rb");
        if (f == NULL) {
            continue;
        }
        SensorData d;
        int moved = 0;
        while (fread(&d, sizeof(SensorData), 1, f) == 1) {
            if (record_is_valid(&d) && append_record(&d) == ESP_OK) {
                moved++;
            }
        }
        fclose(f);
        unlink(LEGACY_PATHS[i]);
        ESP_LOGW(TAG, "Przeniesiono %d rekordow z %s do segmentow", moved, LEGACY_PATHS[i]);
    }
}

static void scan_segments(void) {
    DIR *dir = opendir(BASE_PATH);
    if (dir == NULL) {
        return;
    }
    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        const char *name = (entry->d_name[0] == '/') ? entry->d_name + 1 : entry->d_name;
        unsigned long seg;
        if (sscanf(name, SEG_PREFIX "%lu", &seg) == 1 && seg > 0) {
            if (s_first_seg == 0 || seg < s_first_seg) s_first_seg = seg;
            if (seg > s_last_seg) s_last_seg = seg;
        }
    }
    closedir(dir);
}

esp_err_t offline_buffer_init(void) {
    esp_vfs_spiffs_conf_t conf = {
      .base_path = BASE_PATH,
      .partition_label = PARTITION_LABEL,
      .max_files = 5,
      .format_if_mount_failed = true
    };

    esp_err_t ret = esp_vfs_spiffs_register(&conf);

    if (ret != ESP_OK) {
        if (ret == ESP_FAIL) {
            ESP_LOGE(TAG, "Failed to mount or format filesystem");
        } else if (ret == ESP_ERR_NOT_FOUND) {
            ESP_LOGE(TAG, "Failed to find SPIFFS partition");
        } else {
            ESP_LOGE(TAG, "Failed to initialize SPIFFS (%s)", esp_err_to_name(ret));
        }
        return ret;
    }

    size_t total = 0, used = 0;
    ret = esp_spiffs_info(conf.partition_label, &total, &used);
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "Partition size: total: %d, used: %d", total, used);
    }

    // Starego formatu nie da sie poprawnie odczytac - usuwamy
    bool old_data = (unlink(OLD_FILE_PATH) == 0);
    bool old_temp = (unlink(OLD_TEMP_PATH) == 0);
    if (old_data || old_temp) {
        ESP_LOGW(TAG, "Usunieto bufor w starym formacie");
    }

    scan_segments();
    if (s_last_seg != 0) {
        align_segment(s_last_seg);
    }

    int32_t sent = 0;
    storage_load_i32(NVS_NAMESPACE, NVS_KEY_SENT, &sent, 0);
    s_sent = (sent > 0) ? (uint32_t)sent : 0;
    // Licznik wiekszy niz segment (np. po rollbacku do starszego firmware) - zaczynamy segment od poczatku
    if (s_sent != 0 && (s_first_seg == 0 || s_sent > seg_records(s_first_seg))) {
        ESP_LOGW(TAG, "Licznik wyslanych (%lu) nie pasuje do bufora - zeruje", (unsigned long)s_sent);
        s_sent = 0;
        save_sent();
    }

    migrate_legacy_buffer();

    if (s_first_seg == 0) {
        ESP_LOGI(TAG, "Bufor pusty");
    } else {
        ESP_LOGI(TAG, "Bufor: %u pomiarow do wyslania w segmentach %lu-%lu",
                 (unsigned)offline_buffer_count(), (unsigned long)s_first_seg, (unsigned long)s_last_seg);
    }
    return ESP_OK;
}

esp_err_t offline_buffer_add(SensorData data) {
    esp_err_t err = append_record(&data);
    if (err == ESP_OK) {
        char rom_str[SENSOR_ROM_STR_LEN];
        sensor_rom_to_str(data.sensor_rom, rom_str);
        ESP_LOGI(TAG, "Zapisano offline [TS:%lld] [%s]: T:%.2f C", data.timestamp, rom_str, data.temp);
    }
    return err;
}

size_t offline_buffer_count(void) {
    if (s_first_seg == 0) {
        return 0;
    }
    size_t total = 0;
    for (uint32_t seg = s_first_seg; seg <= s_last_seg; seg++) {
        total += seg_records(seg);
    }
    return (total > s_sent) ? total - s_sent : 0;
}

void offline_process_queue(send_batch_callback_t send_func, size_t max_records) {
    size_t processed = 0;

    while (s_first_seg != 0 && processed < max_records) {
        size_t seg_total = seg_records(s_first_seg);
        if (s_sent >= seg_total) {
            drop_oldest_segment(); // segment wyslany w calosci
            continue;
        }

        char path[32];
        seg_path(s_first_seg, path, sizeof(path));
        FILE *f = fopen(path, "rb");
        if (f == NULL) {
            ESP_LOGE(TAG, "Nie mozna otworzyc %s - reszta bufora w kolejnym cyklu", path);
            return;
        }

        size_t want = seg_total - s_sent;
        if (want > OFFLINE_BATCH_MAX) want = OFFLINE_BATCH_MAX;
        if (want > max_records - processed) want = max_records - processed;

        size_t read = 0;
        if (fseek(f, (long)(s_sent * sizeof(SensorData)), SEEK_SET) == 0) {
            read = fread(s_batch, sizeof(SensorData), want, f);
        }
        fclose(f);
        if (read == 0) {
            ESP_LOGE(TAG, "Blad odczytu %s - reszta bufora w kolejnym cyklu", path);
            return;
        }

        // Uszkodzone rekordy pomijamy - nie blokuja reszty paczki
        size_t valid = 0;
        for (size_t i = 0; i < read; i++) {
            if (record_is_valid(&s_batch[i])) {
                s_batch[valid++] = s_batch[i];
            } else {
                ESP_LOGW(TAG, "Pominieto uszkodzony rekord w %s", path);
            }
        }

        if (valid > 0 && !send_func(s_batch, valid)) {
            ESP_LOGW(TAG, "Wysylka paczki nieudana - reszta bufora w kolejnym cyklu");
            return;
        }

        // Licznik zapisany po potwierdzeniu - restart wczesniej = ta paczka pojdzie jeszcze raz
        s_sent += read;
        processed += read;
        save_sent();
        ESP_LOGI(TAG, "Wyslano z bufora %u pomiarow, zostalo %u", (unsigned)valid, (unsigned)offline_buffer_count());
    }
}
