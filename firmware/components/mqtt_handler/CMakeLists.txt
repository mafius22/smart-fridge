idf_component_register(SRCS "mqtt_handler.c"
                       INCLUDE_DIRS "."
                       REQUIRES mqtt esp_event log offline_buffer ota_handler json)