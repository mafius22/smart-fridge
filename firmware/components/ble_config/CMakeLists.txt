idf_component_register(
    SRCS "ble_config.c"
    INCLUDE_DIRS "."
    
    REQUIRES 
        bt 
        driver 
        esp_timer 
        nvs_flash
        storage_manager
)