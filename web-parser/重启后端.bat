@echo off
chcp 65001 >nul
echo 正在查找占用 19527 端口的进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :19527') do (
    echo 找到 PID: %%a，正在结束...
    taskkill /F /PID %%a 2>nul
)
echo 完成，请重新启动网页解析器。
pause
