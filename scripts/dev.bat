@echo off
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "devctl.ps1" %*
