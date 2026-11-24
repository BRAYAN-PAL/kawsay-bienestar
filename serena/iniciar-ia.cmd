@echo off
cd /d "%~dp0"
node --env-file=.env ai-bridge.mjs
pause
