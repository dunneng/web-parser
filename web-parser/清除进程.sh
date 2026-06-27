#!/bin/bash
echo "Stopping old processes..."
pkill -f "electron" 2>/dev/null
pkill -f "python.*server.py" 2>/dev/null
sleep 3
echo "Cleaning Qdrant lock..."
rm -rf python/data/qdrant_storage 2>/dev/null
echo "Starting..."
cd "$(dirname "$0")"
npx electron .
