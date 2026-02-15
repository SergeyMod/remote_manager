#!/bin/bash

# Проверка наличия папки .venv
if [ ! -d ".venv" ]; then
    echo "Создание виртуального окружения..."
    python3 -m venv .venv
    
    echo "Активация виртуального окружения и установка зависимостей..."
    source .venv/bin/activate
    python -m pip install --upgrade pip
    pip install -r requirements.txt
    
    echo "Запуск приложения..."
    python run.py
else
    echo "Виртуальное окружение найдено. Активация..."
    source .venv/bin/activate
    
    echo "Запуск приложения..."
    python run.py
fi
