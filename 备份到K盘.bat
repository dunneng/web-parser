@echo off
chcp 65001 >nul
echo 备份网页解析器 H: → K: ...
robocopy "H:\网页解析器\web-parser" "K:\网页解析器\web-parser" /MIR /XD node_modules .git dist __pycache__ data /R:2 /W:2
echo 完成
pause
