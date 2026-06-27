@echo off
ping 127.0.0.1 -n 3 >nul
rmdir /s /q "H:\网页解析器\web-parser\data\Local Storage\leveldb" 2>nul
rmdir /s /q "H:\网页解析器\web-parser\data\Local Storage" 2>nul
del "H:\网页解析器\web-parser\cleanup.bat" 2>nul