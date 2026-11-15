@echo off
rem Starts the Aatish API (:8000) and web app (:3000) together. Ctrl+C stops both.
rem Options are passed through, e.g.:  dev.cmd -Open   or   dev.cmd -Reload
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
