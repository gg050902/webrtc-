@echo off
chcp 65001 >nul
rem ═══════════════════════════════════════════════════════════════════
rem  一键放行防火墙（跨电脑进会的最后一步，只需跑一次）
rem  ▎为什么单独做一个文件：Windows 防火墙默认拦入站，别的电脑/手机
rem    会"打不开页面"，而改防火墙必须管理员权限 —— 普通的 npm 脚本
rem    要不了 UAC。双击本文件会自己弹出提权窗口，点"是"就行。
rem  ▎放行范围（刻意收窄，只开这个项目真实要用的两个口）：
rem    TCP 3001,3443        网页入口（HTTP + HTTPS 跨机入口）
rem    UDP 40000-49999      WebRTC 媒体端口段（未启用固定端口时用它）
rem    UDP+TCP 4443-4446    固定媒体端口（K1 跨网：全服务器共用一个号，UDP 被封时走 TCP）
rem      ▸ 为什么要放行 TCP 那一份：只放 UDP 的话，TCP 候选照样会发给对方
rem        但连不进来 —— 那是"机制半成品"，比没有机制更容易误导排查（半个机制最坑）。
rem ═══════════════════════════════════════════════════════════════════
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 需要管理员权限，正在弹出 UAC 提权窗口，请点"是"...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo 已在管理员权限下运行，开始检查/添加规则...
echo.

netsh advfirewall firewall show rule name="meeting-web-tcp" >nul 2>&1
if %errorlevel% neq 0 (
  netsh advfirewall firewall add rule name="meeting-web-tcp" dir=in action=allow protocol=TCP localport=3001,3443
) else (
  echo [跳过] meeting-web-tcp 已存在
)

netsh advfirewall firewall show rule name="meeting-sfu-udp" >nul 2>&1
if %errorlevel% neq 0 (
  netsh advfirewall firewall add rule name="meeting-sfu-udp" dir=in action=allow protocol=UDP localport=40000-49999
) else (
  echo [跳过] meeting-sfu-udp 已存在
)

netsh advfirewall firewall show rule name="meeting-sfu-media" >/dev/null 2>&1
if %errorlevel% neq 0 (
  netsh advfirewall firewall add rule name="meeting-sfu-media" dir=in action=allow protocol=UDP localport=4443-4446
  netsh advfirewall firewall add rule name="meeting-sfu-media-tcp" dir=in action=allow protocol=TCP localport=4443-4446
) else (
  echo [跳过] meeting-sfu-media 已存在
)

echo.
echo 当前规则状态：
netsh advfirewall firewall show rule name="meeting-web-tcp" | findstr /i "已启用 Enabled 操作 Action 本地端口 LocalPort"
netsh advfirewall firewall show rule name="meeting-sfu-udp" | findstr /i "已启用 Enabled 操作 Action 本地端口 LocalPort"
echo.
echo ✅ 完成。另一台电脑/手机现在可以打开 https://本机IP:3443 进会了
echo    （本机IP 看服务器启动日志里那行"局域网访问"，或跑 npm run doctor）
pause
