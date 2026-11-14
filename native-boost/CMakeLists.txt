cmake_minimum_required(VERSION 3.18)
cmake_policy(SET CMP0091 NEW)
project(TASL_Faithful_Boost LANGUAGES CXX)

# Identical placementLoss arithmetic from the ORIGINAL JavaScript Mode 4.
# The rest of the Mode 4 pipeline stays in its original source modules.
add_executable(mode4_score_exact mode4_score_exact.cpp)
set_target_properties(mode4_score_exact PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
if(MSVC)
  set_property(TARGET mode4_score_exact PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  target_compile_options(mode4_score_exact PRIVATE /O2 /utf-8 /W3 /fp:precise)
else()
  target_compile_options(mode4_score_exact PRIVATE -O3 -Wall -Wextra)
endif()

# Native Windows TSL rasterizer (same glyph/layout as original TSL) feeding
# hardware NVENC H.264 when a supported NVIDIA GPU is really available.
if(WIN32)
  # Real native DirectCompute: D3D11 HLSL cs_5_0, no browser WebGPU.
  add_executable(mode4_directcompute mode4_directcompute.cpp)
  target_link_libraries(mode4_directcompute PRIVATE d3d11 dxgi d3dcompiler)
  set_target_properties(mode4_directcompute PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
  if(MSVC)
    set_property(TARGET mode4_directcompute PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    target_compile_options(mode4_directcompute PRIVATE /O2 /utf-8 /W3 /fp:precise)
  endif()
  add_executable(tsl_render tsl_render_win.cpp)
  target_link_libraries(tsl_render PRIVATE gdi32 user32)
  set_target_properties(tsl_render PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
  if(MSVC)
    set_property(TARGET tsl_render PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    target_compile_options(tsl_render PRIVATE /O2 /utf-8 /W3)
  endif()
endif()
