"""Large kernel pipe for the native raster -> FFmpeg stream on Windows."""
import ctypes,os,msvcrt
from ctypes import wintypes
class SecurityAttributes(ctypes.Structure):
 _fields_=[("nLength",wintypes.DWORD),("lpSecurityDescriptor",ctypes.c_void_p),("bInheritHandle",wintypes.BOOL)]
def large_pipe():
 kernel=ctypes.WinDLL("kernel32",use_last_error=True)
 kernel.CreatePipe.argtypes=[ctypes.POINTER(wintypes.HANDLE),ctypes.POINTER(wintypes.HANDLE),ctypes.POINTER(SecurityAttributes),wintypes.DWORD]
 kernel.CreatePipe.restype=wintypes.BOOL
 kernel.CloseHandle.argtypes=[wintypes.HANDLE]
 read,write=wintypes.HANDLE(),wintypes.HANDLE()
 security=SecurityAttributes(ctypes.sizeof(SecurityAttributes),None,True)
 if not kernel.CreatePipe(ctypes.byref(read),ctypes.byref(write),ctypes.byref(security),1024*1024):
  raise ctypes.WinError(ctypes.get_last_error())
 try:
  r=msvcrt.open_osfhandle(read.value,os.O_RDONLY|os.O_BINARY);read.value=None
  try:w=msvcrt.open_osfhandle(write.value,os.O_WRONLY|os.O_BINARY);write.value=None
  except BaseException:os.close(r);raise
  return os.fdopen(r,"rb",buffering=0),os.fdopen(w,"wb",buffering=0)
 finally:
  if read.value:kernel.CloseHandle(read)
  if write.value:kernel.CloseHandle(write)
