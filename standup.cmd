@echo off
REM Launch the standup board and open it in your default browser (Windows).
cd /d "%~dp0"
start "" "http://localhost:7880/"
node server.js
