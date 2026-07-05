cmake_minimum_required(VERSION 3.20)
project(daisy_emu CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---- Opt-in sanitizer configurations (AC-49) ---------------------------------
# Enable with: cmake -DASAN=ON  (AddressSanitizer + UndefinedBehaviorSanitizer)
#              cmake -DTSAN=ON  (ThreadSanitizer)
# The two are mutually exclusive — GCC/Clang do not support combining them.

option(ASAN "Build with AddressSanitizer + UBSanitizer" OFF)
option(TSAN "Build with ThreadSanitizer" OFF)

if(ASAN AND TSAN)
    message(FATAL_ERROR "ASAN and TSAN are mutually exclusive — enable only one at a time.")
endif()

if(ASAN)
    message(STATUS "Sanitizers: AddressSanitizer + UBSanitizer enabled")
    add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
    add_link_options(-fsanitize=address,undefined)
endif()

if(TSAN)
    message(STATUS "Sanitizers: ThreadSanitizer enabled")
    add_compile_options(-fsanitize=thread -fno-omit-frame-pointer)
    add_link_options(-fsanitize=thread)
endif()

# ---- Caller-supplied variables -----------------------------------------------

# Path to the effect source file (required)
set(EFFECT_SRC "" CACHE FILEPATH "Effect source file (.cpp) — required")

# Path to the DaisySP Source/ directory (optional; needed by effects that include daisysp.h)
set(DAISYSP_DIR "" CACHE PATH "DaisySP Source/ directory — optional")

# ---- Validate inputs ---------------------------------------------------------

if(NOT EFFECT_SRC)
    message(FATAL_ERROR "EFFECT_SRC must be set to the effect .cpp file path")
endif()
if(NOT EXISTS "${EFFECT_SRC}")
    message(FATAL_ERROR "EFFECT_SRC does not exist: ${EFFECT_SRC}")
endif()

# ---- Gather sources ----------------------------------------------------------

set(SHIM_SRC
    "${CMAKE_SOURCE_DIR}/shim/src/daisy_seed.cpp"
    "${CMAKE_SOURCE_DIR}/shim/src/adc_handle.cpp"
    "${CMAKE_SOURCE_DIR}/shim/src/system.cpp"
    "${CMAKE_SOURCE_DIR}/shim/src/switch.cpp"
    "${CMAKE_SOURCE_DIR}/shim/src/led.cpp"
)

set(RUNTIME_SRC
    "${CMAKE_SOURCE_DIR}/runtime/main.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/audio_engine.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/core_audio_device.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/ipc_server.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/wav_reader.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/session_recorder.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/session_player.cpp"
)

# DaisySP: glob all .cpp files under DAISYSP_DIR if provided.
# DaisySP source files use bare includes ("dsp.h", "oscillator.h") that resolve
# relative to each sub-directory, so we collect all sub-dirs as include paths.
set(DAISYSP_SRC "")
set(DAISYSP_INCLUDE_DIRS "")
if(DAISYSP_DIR AND EXISTS "${DAISYSP_DIR}")
    file(GLOB_RECURSE DAISYSP_SRC "${DAISYSP_DIR}/*.cpp")
    # Root dir
    list(APPEND DAISYSP_INCLUDE_DIRS "${DAISYSP_DIR}")
    # All immediate sub-directories (Control/, Utility/, Synthesis/, etc.)
    file(GLOB DAISYSP_SUBDIRS LIST_DIRECTORIES true "${DAISYSP_DIR}/*")
    foreach(d IN LISTS DAISYSP_SUBDIRS)
        if(IS_DIRECTORY "${d}")
            list(APPEND DAISYSP_INCLUDE_DIRS "${d}")
        endif()
    endforeach()
    message(STATUS "DaisySP: ${DAISYSP_DIR}")
else()
    message(STATUS "DaisySP: not provided — Osc/DaisySP effects will not link")
endif()

# ---- Effect object -----------------------------------------------------------
# Compiled with -Dmain=effect_main so the effect's main() is renamed.
# The runtime's main() is the real entry point. Stays at -O0 -g (fast
# incremental rebuilds while iterating on effect code); -Wextra -Wshadow
# added for stronger warnings (FR-QA-EMU-8).

add_library(effect_obj OBJECT "${EFFECT_SRC}")
target_include_directories(effect_obj PRIVATE
    "${CMAKE_SOURCE_DIR}/shim/include"
    ${DAISYSP_INCLUDE_DIRS}
)
target_compile_definitions(effect_obj PRIVATE main=effect_main)
target_compile_options(effect_obj PRIVATE
    -O0 -g -Wall -Wextra -Wshadow -Wno-unused-parameter -Wno-unused-variable
)

# ---- Runtime + shim object library --------------------------------------------
# Built at -O2 -g (FR-QA-EMU-8): this is fixed emulator infrastructure, not
# code under active per-effect iteration, so it can afford the optimization
# time and benefits from running closer to real-world timing. -Wextra
# -Wshadow added alongside effect_obj's.

add_library(runtime_shim_obj OBJECT ${SHIM_SRC} ${RUNTIME_SRC})
target_include_directories(runtime_shim_obj PRIVATE
    "${CMAKE_SOURCE_DIR}/shim/include"
    "${CMAKE_SOURCE_DIR}/runtime"
)
target_compile_options(runtime_shim_obj PRIVATE
    -O2 -g -Wall -Wextra -Wshadow -Wno-unused-parameter
)

# ---- Main executable ---------------------------------------------------------

add_executable(effect_emu
    $<TARGET_OBJECTS:effect_obj>
    $<TARGET_OBJECTS:runtime_shim_obj>
    ${DAISYSP_SRC}
)

target_include_directories(effect_emu PRIVATE
    "${CMAKE_SOURCE_DIR}/shim/include"
    "${CMAKE_SOURCE_DIR}/runtime"
    ${DAISYSP_INCLUDE_DIRS}
)

target_compile_options(effect_emu PRIVATE
    -O0 -g -Wall -Wno-unused-parameter -Wno-unused-variable
)

find_package(Threads REQUIRED)
target_link_libraries(effect_emu PRIVATE Threads::Threads m)

# CoreAudio + AudioToolbox for real-time audio I/O (macOS only)
if(APPLE)
    find_library(COREAUDIO_LIB CoreAudio REQUIRED)
    find_library(AUDIOTOOLBOX_LIB AudioToolbox REQUIRED)
    target_link_libraries(effect_emu PRIVATE ${COREAUDIO_LIB} ${AUDIOTOOLBOX_LIB})
endif()
