@echo off
set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
set REF_MEDIA=C:\Windows\System32\WinMetadata\Windows.Media.winmd
set REF_FOUNDATION=C:\Windows\System32\WinMetadata\Windows.Foundation.winmd
set REF_RUNTIME=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\System.Runtime.WindowsRuntime.dll
set REF_INTEROP=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\System.Runtime.InteropServices.WindowsRuntime.dll
set FACADE_DIR=C:\Windows\Microsoft.NET\Framework64\v4.0.30319

:: We need references to standard libraries when using WinRT
set REFS=/r:"%REF_MEDIA%" /r:"%REF_FOUNDATION%" /r:"%REF_RUNTIME%" /r:"%REF_INTEROP%" /r:"%FACADE_DIR%\System.Runtime.dll"

echo Compiling MediaMonitor.exe...
"%CSC%" /target:exe /out:MediaMonitor.exe %REFS% MediaMonitor.cs

echo.
echo Compiling MediaControl.exe...
"%CSC%" /target:exe /out:MediaControl.exe %REFS% MediaControl.cs

echo.
echo Done.
