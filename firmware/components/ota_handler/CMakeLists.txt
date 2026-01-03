idf_component_register(SRCS "ota_handler.c"
                       INCLUDE_DIRS "include"
                       REQUIRES esp_https_ota esp_event esp_log nvs_flash)