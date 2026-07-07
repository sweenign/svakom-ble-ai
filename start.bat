@echo off
title SVAKOM BLE Bridge
echo ====================================
echo   SVAKOM BLE Bridge - 一键启动
echo ====================================
echo.

set BRIDGE_URL=https://svakom-ble-bridge-production.up.railway.app
set BRIDGE_SECRET=d5a36c6239fc484d086e230627128c7e

echo Bridge URL: %BRIDGE_URL%
echo Bridge Secret: %BRIDGE_SECRET%
echo.

echo 正在启动 BLE Bridge...
echo 请确保：
echo   1. 你的 SVAKOM 设备已开机
echo   2. 电脑蓝牙已开启
echo   3. Railway 服务已部署
echo.
echo 按 Ctrl+C 停止
echo ====================================
echo.

C:\Users\16054\AppData\Local\Programs\Python\Python312\python.exe --no-warn-script-location bridge.py

echo.
echo Bridge 已停止。
pause
