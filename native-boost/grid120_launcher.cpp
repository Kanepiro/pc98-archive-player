// Public release launcher. Uses its bundled Python; no OS installation.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string>
#include <vector>
int WINAPI wWinMain(HINSTANCE,HINSTANCE,PWSTR,int){
 std::vector<wchar_t> path(32768);DWORD n=GetModuleFileNameW(nullptr,path.data(),DWORD(path.size()));
 if(!n||n>=path.size())return 1;
 std::wstring dir(path.data(),n);dir=dir.substr(0,dir.find_last_of(L"\\/"));
 std::wstring exe=dir+L"\\runtime\\pythonw.exe";
 std::wstring cmd=L"\""+exe+L"\" \""+dir+L"\\python-source\\launch_grid120.py\"";
 STARTUPINFOW si={};si.cb=sizeof(si);PROCESS_INFORMATION pi={};
 if(!CreateProcessW(exe.c_str(),cmd.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW,nullptr,dir.c_str(),&si,&pi)){
  MessageBoxW(nullptr,L"Cannot start the bundled TASL runtime.",L"TASL Archive Player v0.3.48-rc.1",MB_OK|MB_ICONERROR);return 1;
 }
 CloseHandle(pi.hThread);WaitForSingleObject(pi.hProcess,INFINITE);DWORD code=1;GetExitCodeProcess(pi.hProcess,&code);CloseHandle(pi.hProcess);return int(code);
}
