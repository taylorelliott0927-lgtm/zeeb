@echo off
title Zeeb's PC brain
cd /d "%~dp0.."
if exist pc\PAUSE del pc\PAUSE
node pc\run-zeeb.js
pause
