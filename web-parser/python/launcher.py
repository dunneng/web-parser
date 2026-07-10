"""
启动脚本 — 清除 Hermes venv 污染后启动 server.py
"""
import sys
import os

# 移除 Hermes venv 相关路径
sys.path = [p for p in sys.path if 'hermes' not in p.lower()]

# 确保能找到当前目录的 parser 模块
sys.path.insert(0, os.path.dirname(__file__))

# 执行原始 server.py
exec(open(os.path.join(os.path.dirname(__file__), 'server.py'), encoding='utf-8').read())
