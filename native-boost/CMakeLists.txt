cmake_minimum_required(VERSION 3.18)
cmake_policy(SET CMP0091 NEW)
project(TASL_PC_Boost LANGUAGES CXX)

add_executable(tsl_boost tsl_boost.cpp)
set_target_properties(tsl_boost PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
if(MSVC)
  set_property(TARGET tsl_boost PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  target_compile_options(tsl_boost PRIVATE /O2 /utf-8 /W3)
else()
  target_compile_options(tsl_boost PRIVATE -O3 -Wall -Wextra)
endif()

# Win32 GDI rasterizes the actual CP932 TSL glyphs directly to BGRA frames.
# FFmpeg h264_nvenc then receives those frames for real NVIDIA hardware encoding.
if(WIN32)
  add_executable(tsl_render tsl_render_win.cpp)
  target_link_libraries(tsl_render PRIVATE gdi32 user32)
  set_target_properties(tsl_render PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
  if(MSVC)
    set_property(TARGET tsl_render PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    target_compile_options(tsl_render PRIVATE /O2 /utf-8 /W3)
  endif()
endif()
