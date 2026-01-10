import subprocess
import sys
import os


def install_requirements():
    print("Устанавливаем зависимости...")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])


def create_directories():
    print("Создаем структуру директорий...")
    os.makedirs("static/css", exist_ok=True)
    os.makedirs("static/js", exist_ok=True)
    os.makedirs("templates", exist_ok=True)


if __name__ == "__main__":
    # create_directories()
    # install_requirements()

    print("Запускаем приложение...")
    print("Откройте в браузере: http://localhost:8000")

    from app import app
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)