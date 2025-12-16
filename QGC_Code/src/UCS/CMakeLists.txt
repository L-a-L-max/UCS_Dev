# UCS Integration Module CMakeLists.txt
# This module provides integration with the UCS Backend Server

find_package(Qt6 REQUIRED COMPONENTS Core Network Qml)

qt_add_library(UCS STATIC
    UCSApiClient.cc
    UCSApiClient.h
    UCSManager.cc
    UCSManager.h
)

target_link_libraries(UCS
    PRIVATE
        Qt6::Core
        Qt6::Network
        Qt6::Qml
)

target_include_directories(UCS
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
)
