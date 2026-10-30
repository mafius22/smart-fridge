# The following five lines of boilerplate have to be in your project's
# CMakeLists in this exact order for cmake to work correctly
cmake_minimum_required(VERSION 3.16)

# Nie sprawdzaj nowych wersji komponentow przy kazdym buildzie.
# Aktualizacja bibliotek tylko recznie: idf.py update-dependencies
set(ENV{IDF_COMPONENT_CHECK_NEW_VERSION} 0)

# Wersja firmware - widoczna w logu startu i w statusie MQTT. Podnosic przy kazdym wydaniu (OTA).
set(PROJECT_VER "1.0.0")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(firmware)
