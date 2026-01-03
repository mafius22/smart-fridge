idf_component_register(SRCS "ble_config.c"
                       INCLUDE_DIRS "."
                       REQUIRES nvs_flash esp_wifi esp_event driver bt storage_manager zorxx__bmp180)