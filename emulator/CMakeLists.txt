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

# FR-WIN-BLD-4: clang/MinGW has no ThreadSanitizer runtime; ASan+UBSan
# need clang (MinGW GCC ships no ASan runtime).
if(TSAN AND WIN32)
    message(FATAL_ERROR "TSAN is not supported on Windows — use -DASAN=ON or a macOS/Linux build.")
endif()
if(ASAN AND WIN32 AND NOT CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    message(FATAL_ERROR "ASAN on Windows requires clang/MinGW (found ${CMAKE_CXX_COMPILER_ID}).")
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
    "${CMAKE_SOURCE_DIR}/shim/src/switch3.cpp"
    "${CMAKE_SOURCE_DIR}/shim/src/led.cpp"
    "${CMAKE_SOURCE_DIR}/shim/src/rgb_led.cpp"
    "${CMAKE_SOURCE_DIR}/shim/src/encoder.cpp"
    "${CMAKE_SOURCE_DIR}/shim/src/fatfs_host.cpp"
    "${CMAKE_SOURCE_DIR}/shim/src/oled_display.cpp"
    "${CMAKE_SOURCE_DIR}/shim/src/midi_event.cpp"
    "${CMAKE_SOURCE_DIR}/shim/src/midi_uart_handler.cpp"
    "${CMAKE_SOURCE_DIR}/shim/src/midi_usb_handler.cpp"
)

set(RUNTIME_SRC
    "${CMAKE_SOURCE_DIR}/runtime/main.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/audio_engine.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/audio_device_factory.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/ipc_server.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/ipc_transport_socket.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/ipc_transport_tcp.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/wav_reader.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/input_generators.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/session_recorder.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/session_player.cpp"
    "${CMAKE_SOURCE_DIR}/runtime/platform_file.cpp"
)

# ---- Per-platform sources (FR-WIN-BLD-4) --------------------------------------
# audio_device_factory.cpp is listed everywhere (FR-WIN-AUD-1): the CoreAudio
# backend is built only on Apple, the RtAudio backend only on Windows
# (FR-WIN-AUD-5, see "RtAudio" below); elsewhere the factory returns the
# header-only no-backend NullAudioDevice (all start* return false).
# The IPC transport (FR-WIN-IPC-1): TCP loopback builds everywhere (the
# Windows transport, testable on POSIX); the Unix-socket transport is POSIX
# only.
if(NOT WIN32)
    list(APPEND RUNTIME_SRC "${CMAKE_SOURCE_DIR}/runtime/ipc_transport_unix.cpp")
endif()
if(APPLE)
    list(APPEND RUNTIME_SRC "${CMAKE_SOURCE_DIR}/runtime/core_audio_device.cpp")
endif()
if(WIN32)
    list(APPEND RUNTIME_SRC "${CMAKE_SOURCE_DIR}/runtime/audio_device_rtaudio.cpp")
endif()

# ---- RtAudio (Windows audio backend, FR-WIN-AUD-5) -----------------------------
# Vendored at vendor/RtAudio (6.0.1, see its README.md), a sibling of emulator/
# in both the repo and the packaged extension. WASAPI is always compiled in.
# ASIO is opt-in: point ASIO_SDK_DIR at a directory holding the ASIO SDK
# sources RtAudio expects (asio.cpp, asiodrivers.cpp, asiolist.cpp,
# iasiothiscallresolver.cpp and their headers — the layout of RtAudio's
# upstream include/ directory); DS_EMU_AUDIO_API=asio then selects it at runtime.
set(ASIO_SDK_DIR "" CACHE PATH "ASIO SDK sources for the RtAudio ASIO API (Windows) — optional")
set(RTAUDIO_DIR "${CMAKE_SOURCE_DIR}/../vendor/RtAudio")
if(WIN32)
    if(NOT EXISTS "${RTAUDIO_DIR}/RtAudio.cpp")
        message(FATAL_ERROR "RtAudio not found at ${RTAUDIO_DIR}")
    endif()
    # Third-party code: built without the project's warning set.
    add_library(rtaudio_obj OBJECT "${RTAUDIO_DIR}/RtAudio.cpp")
    target_include_directories(rtaudio_obj PRIVATE "${RTAUDIO_DIR}")
    target_compile_definitions(rtaudio_obj PRIVATE __WINDOWS_WASAPI__)
    target_compile_options(rtaudio_obj PRIVATE -O2 -g -w)
    if(ASIO_SDK_DIR)
        set(ASIO_SDK_SRC
            "${ASIO_SDK_DIR}/asio.cpp"
            "${ASIO_SDK_DIR}/asiodrivers.cpp"
            "${ASIO_SDK_DIR}/asiolist.cpp"
            "${ASIO_SDK_DIR}/iasiothiscallresolver.cpp")
        foreach(f IN LISTS ASIO_SDK_SRC)
            if(NOT EXISTS "${f}")
                message(FATAL_ERROR "ASIO_SDK_DIR is missing ${f}")
            endif()
        endforeach()
        target_sources(rtaudio_obj PRIVATE ${ASIO_SDK_SRC})
        target_include_directories(rtaudio_obj PRIVATE "${ASIO_SDK_DIR}")
        target_compile_definitions(rtaudio_obj PRIVATE __WINDOWS_ASIO__)
        message(STATUS "RtAudio: WASAPI + ASIO (${ASIO_SDK_DIR})")
    else()
        message(STATUS "RtAudio: WASAPI (set ASIO_SDK_DIR to add ASIO)")
    endif()
endif()

# DaisySP: glob all .cpp files under DAISYSP_DIR if provided.
# DaisySP source files use bare includes ("dsp.h", "oscillator.h") that resolve
# relative to each sub-directory, so we collect all sub-dirs as include paths.
set(DAISYSP_SRC "")
set(DAISYSP_INCLUDE_DIRS "")
if(DAISYSP_DIR AND EXISTS "${DAISYSP_DIR}")
    file(GLOB_RECURSE DAISYSP_SRC "${DAISYSP_DIR}/*.cpp")
    # DaisySP's Utility/dsp.h uses RAND_MAX without including <cstdlib>: real
    # libDaisy supplies it transitively, macOS headers happen to as well, and
    # MinGW's libc++ does not. Force it in for DaisySP's own sources so the
    # vendored tree stays untouched (the effect itself gets it from daisy_seed.h).
    set_source_files_properties(${DAISYSP_SRC} PROPERTIES COMPILE_OPTIONS "-include;cstdlib")
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
if(WIN32)
    target_include_directories(runtime_shim_obj PRIVATE "${RTAUDIO_DIR}")
endif()
target_compile_options(runtime_shim_obj PRIVATE
    -O2 -g -Wall -Wextra -Wshadow -Wno-unused-parameter
)

# ---- Main executable ---------------------------------------------------------

add_executable(effect_emu
    $<TARGET_OBJECTS:effect_obj>
    $<TARGET_OBJECTS:runtime_shim_obj>
    ${DAISYSP_SRC}
)
if(WIN32)
    target_sources(effect_emu PRIVATE $<TARGET_OBJECTS:rtaudio_obj>)
endif()

target_include_directories(effect_emu PRIVATE
    "${CMAKE_SOURCE_DIR}/shim/include"
    "${CMAKE_SOURCE_DIR}/runtime"
    ${DAISYSP_INCLUDE_DIRS}
)

target_compile_options(effect_emu PRIVATE
    -O0 -g -Wall -Wno-unused-parameter -Wno-unused-variable
)

find_package(Threads REQUIRED)
target_link_libraries(effect_emu PRIVATE Threads::Threads)

# ---- Per-platform libraries (FR-WIN-BLD-4) -------------------------------------
if(APPLE)
    # CoreAudio + AudioToolbox for real-time audio I/O
    find_library(COREAUDIO_LIB CoreAudio REQUIRED)
    find_library(AUDIOTOOLBOX_LIB AudioToolbox REQUIRED)
    target_link_libraries(effect_emu PRIVATE m ${COREAUDIO_LIB} ${AUDIOTOOLBOX_LIB})
elseif(WIN32)
    # Winsock for the TCP IPC transport (FR-WIN-IPC-1); COM, Media Foundation
    # (WASAPI resampler) and winmm for RtAudio's WASAPI API (FR-WIN-AUD-5).
    target_link_libraries(effect_emu PRIVATE ws2_32
        ole32 winmm ksuser mfplat mfuuid wmcodecdspuuid)
else()
    target_link_libraries(effect_emu PRIVATE m)
endif()
