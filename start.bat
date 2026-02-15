@echo off
chcp 65001 > nul

REM Проверка наличия папки .venv
if not exist ".venv" (
    echo Создание виртуального окружения...
    python -m venv .venv
    
    echo Активация виртуального окружения и установка зависимостей...
    call .venv\Scripts\activate.bat
    python -m pip install --upgrade pip
    pip install -r requirements.txt
    
    echo Запуск приложения...
    python run.py
) else (
    echo Виртуальное окружение найдено. Активация...
    call .venv\Scripts\activate.bat
    
    echo Запуск приложения...
    python run.py
)
