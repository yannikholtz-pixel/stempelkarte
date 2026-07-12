@echo off
cd /d "%~dp0"
start "" http://localhost:3535/julia
node server.js
pause
