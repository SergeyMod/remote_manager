import sys
from fastapi import FastAPI, Request, Depends, HTTPException, WebSocket, \
    WebSocketDisconnect, Body
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
import database
import models
from ssh_manager import ssh_manager
import crud
from typing import List, Dict, Any
import datetime
import json
import asyncio
import socket
import logging
import re


# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SSH Manager")

# Монтируем статические файлы и шаблоны
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


def substitute_script_params(script_content: str, params: list) -> str:
    """Подставляет параметры вида $NAME или ${NAME} в скрипт."""
    result = script_content
    for p in params:
        name = str(p.get('name', '')).strip()
        value = str(p.get('value', ''))
        if not name:
            continue
        # Экранируем одинарные кавычки для shell
        safe_value = value.replace("'", "'\"'\"'")
        # Шаблон: совпадает $NAME и ${NAME}
        pattern = r'\$(?:' + re.escape(name) + r'\b|\{' + re.escape(name) + r'\})'
        # Заменяем на значение в одинарных кавычках
        result = re.sub(pattern, f"'{safe_value}'", result)
    return result

# Создаем таблицы при старте
@app.on_event("startup")
async def startup():
    try:
        models.Base.metadata.create_all(bind=database.engine)
        logger.info("Database tables created")

        # Определяем текущую машину
        current_address = ssh_manager.get_current_machine_address()
        db = database.SessionLocal()
        try:
            crud.set_current_machine(db, current_address)
            logger.info(f"Current machine address: {current_address}")

            # Нормализуем поле username у машин: если там хранится id пользователя (число),
            # заменяем его на реальный username из таблицы users
            try:
                machines = crud.get_machines(db)
                for m in machines:
                    if m.username and isinstance(m.username, str) and m.username.isdigit():
                        try:
                            uid = int(m.username)
                            user = crud.get_user(db, uid)
                            if user:
                                logger.info(f"Normalizing machine {m.id} username from id {uid} to '{user.username}'")
                                m.username = user.username
                                db.commit()
                        except Exception as e:
                            logger.warning(f"Failed to normalize username for machine {m.id}: {e}")
            except Exception as e:
                logger.warning(f"Error while normalizing machine usernames: {e}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Startup error: {e}")


# Dependency для получения БД
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


# WebSocket для обновлений
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(
            f"WebSocket connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        logger.info(
            f"WebSocket disconnected. Total connections: {len(self.active_connections)}")

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"WebSocket broadcast error: {e}")
                # Удаляем нерабочие соединения из списка
                try:
                    self.active_connections.remove(connection)
                except ValueError:
                    pass


manager = ConnectionManager()


# API endpoints
@app.get("/api/machines")
async def get_machines_api(db: Session = Depends(get_db)):
    try:
        machines = crud.get_machines(db)
        return machines
    except Exception as e:
        logger.error(f"Error getting machines: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/machines")
async def create_machine_api(machine: dict, db: Session = Depends(get_db)):
    try:
        # Проверяем уникальность адреса
        existing = crud.get_machine_by_address(db, machine["address"])
        if existing:
            raise HTTPException(status_code=400,
                                detail="Machine with this address already exists")

        # Валидация SSH подключения перед сохранением
        address = machine.get("address")
        ssh_port = machine.get("ssh_port", 22)
        username = str(machine.get("username")) if machine.get("username") is not None else None
        password = machine.get("password")
        success, message = await ssh_manager.test_connection(address, ssh_port, username, password)
        if not success:
            raise HTTPException(status_code=400, detail=f"SSH connection failed: {message}")

        db_machine = crud.create_machine(db, machine)
        await manager.broadcast(
            json.dumps({"type": "update", "entity": "machines"}))
        return db_machine
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating machine: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# Test SSH connection for new machine (без сохранения в БД)
@app.post("/api/machines/test")
async def test_ssh_connection(machine_data: dict):
    """
    Тестирование SSH подключения к новой машине (без сохранения в БД)
    """
    try:
        # Получаем данные из запроса
        address = machine_data.get("address")
        ssh_port = machine_data.get("ssh_port", 22)
        username = machine_data.get("username")
        password = machine_data.get("password")

        # Валидация входных данных
        if not all([address, username, password]):
            raise HTTPException(
                status_code=400,
                detail="Missing required fields: address, username, password"
            )

        # Тестируем подключение
        success, message = await ssh_manager.test_connection(
            address, ssh_port, username, password
        )

        return {
            "success": success,
            "message": message,
            "machine_data": {
                "address": address,
                "ssh_port": ssh_port,
                "username": username
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error testing SSH connection: {e}")
        raise HTTPException(status_code=500,
                            detail=f"Internal server error: {str(e)}")


@app.get("/api/machines/{machine_id}")
async def get_machine_api(machine_id: int, db: Session = Depends(get_db)):
    try:
        machine = crud.get_machine(db, machine_id)
        if not machine:
            raise HTTPException(status_code=404, detail="Machine not found")
        return machine
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting machine: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.put("/api/machines/{machine_id}")
async def update_machine_api(machine_id: int, machine_data: dict,
                             db: Session = Depends(get_db)):
    try:
        db_machine = crud.update_machine(db, machine_id, machine_data)
        if not db_machine:
            raise HTTPException(status_code=404, detail="Machine not found")

        # Проверяем подключение после обновления
        address = db_machine.address
        ssh_port = db_machine.ssh_port
        username = str(db_machine.username) if db_machine.username is not None else None
        password = db_machine.password
        success, message = await ssh_manager.test_connection(address, ssh_port, username, password)
        if not success:
            # Помечаем машину как неактивную и удаляем мёртвое соединение
            crud.update_machine_status(db, machine_id, False)
            try:
                await ssh_manager.remove_connection(address, ssh_port, username)
            except Exception as e:
                logger.warning(f"Error removing connection cache: {e}")
            await manager.broadcast(json.dumps({"type": "update", "entity": "machines"}))
            return JSONResponse(status_code=400, content={"success": False, "message": f"SSH connection failed: {message}. Machine marked inactive.", "deactivated": True})

        await manager.broadcast(
            json.dumps({"type": "update", "entity": "machines"}))
        return db_machine
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating machine: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.delete("/api/machines/{machine_id}")
async def delete_machine_api(machine_id: int, db: Session = Depends(get_db)):
    try:
        result = crud.delete_machine(db, machine_id)
        if not result:
            raise HTTPException(status_code=404, detail="Machine not found")
        await manager.broadcast(
            json.dumps({"type": "update", "entity": "machines"}))
        return {"message": "Machine deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting machine: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/machines/{machine_id}/test")
async def test_machine_connection(machine_id: int,
                                  db: Session = Depends(get_db)):
    try:
        machine = crud.get_machine(db, machine_id)
        if not machine:
            raise HTTPException(status_code=404, detail="Machine not found")

        success, message = await ssh_manager.test_connection(
            machine.address, machine.ssh_port, machine.username,
            machine.password
        )

        if success:
            # Обновляем статус
            crud.update_machine_status(db, machine_id, True)
            await manager.broadcast(json.dumps({"type": "update", "entity": "machines"}))
            return {"success": True, "message": message}
        else:
            # Помечаем машину как неактивную и удаляем мёртвое соединение
            crud.update_machine_status(db, machine_id, False)
            try:
                await ssh_manager.remove_connection(machine.address, machine.ssh_port, machine.username)
            except Exception as e:
                logger.warning(f"Error removing connection cache: {e}")
            await manager.broadcast(json.dumps({"type": "update", "entity": "machines"}))
            return {"success": False, "message": message, "deactivated": True} 

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error testing machine connection: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/machines/batch-test")
async def batch_test_machines(db: Session = Depends(get_db)):
    try:
        machines = crud.get_machines(db)
        results = []

        for machine in machines:
            success, message = await ssh_manager.test_connection(
                machine.address, machine.ssh_port, machine.username,
                machine.password
            )
            if success:
                crud.update_machine_status(db, machine.id, True)
                results.append({
                    "machine_id": machine.id,
                    "name": machine.name,
                    "success": True,
                    "message": message,
                    "deactivated": False
                })
            else:
                # Помечаем машину неактивной и удаляем мёртвое соединение
                crud.update_machine_status(db, machine.id, False)
                try:
                    await ssh_manager.remove_connection(machine.address, machine.ssh_port, machine.username)
                except Exception as e:
                    logger.warning(f"Error removing connection cache for {machine.address}: {e}")
                results.append({
                    "machine_id": machine.id,
                    "name": machine.name,
                    "success": False,
                    "message": message,
                    "deactivated": True
                })

        await manager.broadcast(
            json.dumps({"type": "update", "entity": "machines"}))
        return results
    except Exception as e:
        logger.error(f"Error batch testing machines: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/machines/{machine_id}/processes")
async def get_machine_processes(machine_id: int,
                                db: Session = Depends(get_db)):
    try:
        machine = crud.get_machine(db, machine_id)
        if not machine:
            raise HTTPException(status_code=404, detail="Machine not found")

        # Получаем процессы из базы
        processes = crud.get_machine_processes(db, machine_id)
        return processes
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting machine processes: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# Script endpoints
@app.get("/api/scripts/{script_id}")
async def get_script_api(script_id: int, db: Session = Depends(get_db)):
    script = crud.get_script(db, script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    try:
        params = json.loads(script.parameters) if script.parameters else []
    except:
        params = []

    # Убедитесь, что параметры уже распарсены (в crud.get_script они парсятся)
    return {
        "id": script.id,
        "name": script.name,
        "content": script.content,
        "parameters": params,  
        "created_at": script.created_at.isoformat() if script.created_at else None,
        "updated_at": script.updated_at.isoformat() if script.updated_at else None
    }


@app.get("/api/scripts")
async def get_scripts_api(db: Session = Depends(get_db)):
    try:
        scripts = crud.get_scripts(db)
        result = []
        for s in scripts:
            # Парсим параметры из JSON-поля
            try:
                params = json.loads(s.parameters) if s.parameters else []
            except:
                params = []
            result.append({
                'id': s.id,
                'name': s.name,
                'content': s.content,
                'created_at': s.created_at.isoformat() if s.created_at else None,
                'updated_at': s.updated_at.isoformat() if s.updated_at else None,
                'parameters': params
            })
        return result
    except Exception as e:
        logger.error(f"Error getting scripts: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/scripts")
async def create_script_api(script: dict=Body(...), db: Session = Depends(get_db)):
    try:
        params = script.pop('params', [])
        script['parameters'] = json.dumps(params)  # ← сериализация
        db_script = crud.create_script(db, script)
        return db_script
    except Exception as e:
        logger.error(f"Error creating script: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/scripts")
async def get_scripts_api(db: Session = Depends(get_db)):
    try:
        scripts = crud.get_scripts(db)
        result = []
        for s in scripts:
            # Парсим параметры из JSON-поля Script.parameters
            try:
                params = json.loads(s.parameters) if s.parameters else []
            except:
                params = []
            result.append({
                'id': s.id,
                'name': s.name,
                'content': s.content,
                'created_at': s.created_at.isoformat() if s.created_at else None,
                'updated_at': s.updated_at.isoformat() if s.updated_at else None,
                'parameters': params
            })
        return result
    except Exception as e:
        logger.error(f"Error getting scripts: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.put("/api/scripts/{script_id}")
async def update_script_api(script_id: int, script_dict=Body(...), 
                            db: Session = Depends(get_db)):
    try:

        # Извлекаем параметры (фронтенд отправляет их как 'params')
        params = script_dict.pop('params', [])
        
        # Сериализуем параметры в JSON-строку для сохранения в БД
        script_dict['parameters'] = json.dumps(params)

        # Обновляем сценарий
        updated_script = crud.update_script(db, script_id, script_dict)
        if not updated_script:
            raise HTTPException(status_code=404, detail="Script not found")

        return {
            "id": updated_script.id,
            "name": updated_script.name,
            "content": updated_script.content,
            "parameters": json.loads(updated_script.parameters) if updated_script.parameters else [],
            "updated_at": updated_script.updated_at.isoformat() if updated_script.updated_at else None
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating script {script_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.delete("/api/scripts/{script_id}")
async def delete_script_api(script_id: int, db: Session = Depends(get_db)):
    try:
        result = crud.delete_script(db, script_id)
        if not result:
            raise HTTPException(status_code=404, detail="Script not found")
        await manager.broadcast(
            json.dumps({"type": "update", "entity": "scripts"}))
        return {"message": "Script deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting script: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/scripts/{script_id}/execute")
async def execute_script_api(script_id: int, request: dict, db: Session = Depends(get_db)):
    try:
        script = crud.get_script(db, script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Script not found")

        machine_ids = request.get("machine_ids", [])
        params = request.get("params", [])  # list of {name, value, save, description}

        logger.info(f"Executing script {script_id} with params: {params}")

        # ENDPOINT может быть только один
        endpoint_count = sum(1 for p in params if p.get('name') and p.get('name').upper() == 'ENDPOINT')
        if endpoint_count > 1:
            raise HTTPException(status_code=400, detail="Only one ENDPOINT parameter is allowed")

        # Обрабатываем сохранение параметров
        for p in params:
            if p.get('save'):
                name = str(p.get('name') or '').strip()
                value = str(p.get('value') or '')
                description = p.get('description', '')
                if name:
                    existing = crud.get_parameter_by_name(db, name)
                    if existing:
                        existing.value = value
                        existing.description = description
                        db.commit()
                    else:
                        crud.create_parameter(db, {"name": name, "value": value, "description": description})
                    await manager.broadcast(json.dumps({"type": "update", "entity": "parameters"}))

        # Подстановка параметров в скрипт (единожды)
        final_script_content = substitute_script_params(script.content, params)

        # Запуск в фоне
        asyncio.create_task(execute_script_background_content(final_script_content, machine_ids, script_id))

        return {
            "message": f"Script execution started on {len(machine_ids)} machines",
            "script_id": script_id,
            "machine_count": len(machine_ids)
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error executing script {script_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


async def execute_script_background_content(script_content: str, machine_ids: List[int], originating_script_id: int = None):
    """Фоновая задача выполнения скрипта по переданному контенту"""
    db = database.SessionLocal()
    try:
        for machine_id in machine_ids:
            machine = crud.get_machine(db, machine_id)
            if machine and machine.is_active:
                success, stdout, stderr = await ssh_manager.execute_script(
                    machine.address, machine.ssh_port, machine.username,
                    machine.password,
                    script_content
                )

                process_data = {
                    "machine_id": machine_id,
                    "script_id": originating_script_id,
                    "command": f"exec_script_{originating_script_id or 'custom'}",
                    "status": "running" if success else "error",
                    "pid": None
                }
                crud.create_process(db, process_data)
                logger.info(f"Executed script on {machine.name}: {'success' if success else 'failed'}")

    except Exception as e:
        logger.error(f"Error in background script execution: {e}")
    finally:
        db.close()


# Parameter endpoints
@app.get('/api/parameters')
async def get_parameters_api(db: Session = Depends(get_db)):
    try:
        params = crud.get_parameters(db)
        # return simplified dicts
        return [p.to_dict() for p in params]
    except Exception as e:
        logger.error(f"Error getting parameters: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post('/api/parameters')
async def create_parameter_api(parameter_data: dict, db: Session = Depends(get_db)):
    try:
        name = parameter_data.get('name')
        value = parameter_data.get('value')
        description = parameter_data.get('description')
        if not name or value is None:
            raise HTTPException(status_code=400, detail='Missing name or value')
        existing = crud.get_parameter_by_name(db, name)
        if existing:
            raise HTTPException(status_code=400, detail='Parameter with this name already exists')
        p = crud.create_parameter(db, { 'name': name, 'value': value, 'description': description })
        await manager.broadcast(json.dumps({"type": "update", "entity": "parameters"}))
        return p.to_dict()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating parameter: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# Profile endpoints
@app.get("/api/profiles")
async def get_profiles_api(db: Session = Depends(get_db)):
    try:
        profiles = crud.get_profiles(db)
        return profiles
    except Exception as e:
        logger.error(f"Error getting profiles: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/profiles")
async def create_profile_api(request: dict, db: Session = Depends(get_db)):
    try:
        name = request.get("name")
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")

        # Валидация шагов
        steps = request.get("steps", [])
        if not steps:
            raise HTTPException(status_code=400, detail="At least one step is required")

        for step in steps:
            if not step.get("script_id"):
                raise HTTPException(status_code=400, detail="Script ID is required in each step")
            if not isinstance(step.get("machine_ids", []), list):
                raise HTTPException(status_code=400, detail="machine_ids must be a list")

        profile_data = {
            "name": name,
            "global_parameters": request.get("global_parameters", []),
            "steps": steps
        }

        profile = crud.create_profile(db, profile_data)
        return {"id": profile.id, "name": profile.name}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating profile: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal error")


@app.put("/api/profiles/{profile_id}")
async def update_profile_api(profile_id: int, request: dict, db: Session = Depends(get_db)):
    try:
        existing = crud.get_profile(db, profile_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Profile not found")

        name = request.get("name")
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")

        steps = request.get("steps", [])
        if not steps:
            raise HTTPException(status_code=400, detail="At least one step is required")

        for step in steps:
            if not step.get("script_id"):
                raise HTTPException(status_code=400, detail="Script ID is required in each step")

        profile_data = {
            "name": name,
            "global_parameters": request.get("global_parameters", []),
            "steps": steps
        }

        profile = crud.update_profile(db, profile_id, profile_data)
        return {"id": profile.id, "name": profile.name}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating profile {profile_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal error")


@app.get("/api/profiles/{profile_id}")
async def get_profile_api(profile_id: int, db: Session = Depends(get_db)):
    profile_data = crud.get_profile_with_steps(db, profile_id)
    if not profile_data:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile_data  # ← это dict, и это нормально для JSON API


@app.delete("/api/profiles/{profile_id}")
async def delete_profile_api(profile_id: int, db: Session = Depends(get_db)):
    try:
        result = crud.delete_profile(db, profile_id)
        if not result:
            raise HTTPException(status_code=404, detail="Profile not found")
        await manager.broadcast(
            json.dumps({"type": "update", "entity": "profiles"}))
        return {"message": "Profile deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting profile: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/profiles/{profile_id}/execute")
async def execute_profile_api(
    profile_id: int, 
    request: Request,
    db: Session = Depends(get_db)
):
    try:
        # Получаем профиль как модель (не dict!)
        profile = crud.get_profile(db, profile_id)
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")

        # Получаем шаги (ProfileScript)
        profile_scripts = crud.get_profile_scripts(db, profile_id)

        # Парсим глобальные параметры из поля (не метода!)
        global_params = json.loads(profile.global_parameters) if profile.global_parameters else []

        # Фильтруем только включенные шаги
        profile_scripts = [ps for ps in profile_scripts if getattr(ps, 'enabled', True)]

        results = []

        for ps in profile_scripts:
            script = crud.get_script(db, ps.script_id)
            if not script:
                continue

            # Парсим machine_ids и parameters из строк
            machine_ids = json.loads(ps.machine_ids) if ps.machine_ids else []
            script_params = json.loads(ps.parameters) if ps.parameters else []

            try:
                script_params_list = json.loads(script.parameters) if script.parameters else []
            except:
                script_params_list = []

            # Объединяем: сначала глобальные, потом параметры шага (шаг переопределяет)
            param_dict = {}

            for p in script_params_list:
                param_dict[p['name']] = p['default_value']

            for p in global_params:
                param_dict[p['name']] = p['value']

            for p in script_params:
                param_dict[p['name']] = p['value']

            combined_params = [{"name": k, "value": v} for k, v in param_dict.items()]

            # Подставляем в скрипт
            final_script_content = substitute_script_params(script.content, combined_params)

            # Запуск на машинах
            for machine_id in machine_ids:
                machine = crud.get_machine(db, machine_id)
                if not machine or not machine.is_active:
                    continue

                success, stdout, stderr = await ssh_manager.execute_script(
                    machine.address,
                    machine.ssh_port,
                    machine.username,
                    machine.password,
                    final_script_content
                )

                # Сохраняем процесс (опционально)
                process_data = {
                    "machine_id": machine_id,
                    "script_id": script.id,
                    "command": f"Profile: {profile.name} - {script.name}",
                    "status": "running" if success else "error",
                    "pid": None
                }
                crud.create_process(db, process_data)

                results.append({
                    "script": script.name,
                    "machine": machine.name,
                    "success": success
                })

        await manager.broadcast(json.dumps({"type": "update", "entity": "processes"}))
        return {"message": f"Profile '{profile.name}' executed", "results": results}

    except Exception as e:
        logger.error(f"Profile execution error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    

@app.get("/scripts/new")
async def new_script_page(request: Request):
    return templates.TemplateResponse("script_form.html", {"request": request, "mode": "create"})

@app.get("/scripts/{script_id}/edit")
async def edit_script_page(script_id: int, request: Request, db: Session = Depends(get_db)):
    script = crud.get_script(db, script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    # Parse parameters from JSON string
    script_dict = {
        "id": script.id,
        "name": script.name,
        "content": script.content,
        "parameters": json.loads(script.parameters) if script.parameters else []
    }
    
    return templates.TemplateResponse("script_form.html", {
        "request": request,
        "mode": "edit",
        "script": script_dict
    })

@app.get("/profiles/new")
async def new_profile_page(request: Request):
    return templates.TemplateResponse("profile_form.html", {"request": request, "mode": "create"})

@app.get("/profiles/{profile_id}/edit")
async def edit_profile_page(profile_id: int, request: Request, db: Session = Depends(get_db)):
    profile_data = crud.get_profile_with_steps(db, profile_id)
    if not profile_data:
        raise HTTPException(status_code=404, detail="Profile not found")
    return templates.TemplateResponse("profile_form.html", {
        "request": request,
        "mode": "edit",
        "profile": profile_data
    })
    

# User endpoints
@app.get("/api/users")
async def get_users_api(db: Session = Depends(get_db)):
    try:
        users = crud.get_users(db)
        return users
    except Exception as e:
        logger.error(f"Error getting users: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/users")
async def create_user_api(user: dict, db: Session = Depends(get_db)):
    try:
        # Проверяем уникальность имени пользователя
        existing = crud.get_user_by_username(db, user["username"])
        if existing:
            raise HTTPException(status_code=400, detail="User already exists")

        db_user = crud.create_user(db, user)
        await manager.broadcast(
            json.dumps({"type": "update", "entity": "users"}))
        return db_user
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating user: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.put("/api/users/{user_id}")
async def update_user_api(user_id: int, user_data: dict,
                          db: Session = Depends(get_db)):
    try:
        db_user = crud.update_user(db, user_id, user_data)
        if not db_user:
            raise HTTPException(status_code=404, detail="User not found")
        await manager.broadcast(
            json.dumps({"type": "update", "entity": "users"}))
        return db_user
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating user: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.delete("/api/users/{user_id}")
async def delete_user_api(user_id: int, db: Session = Depends(get_db)):
    try:
        result = crud.delete_user(db, user_id)
        if not result:
            raise HTTPException(status_code=404, detail="User not found")
        await manager.broadcast(
            json.dumps({"type": "update", "entity": "users"}))
        return {"message": "User deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting user: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# Process endpoints
@app.get("/api/processes/live")
async def get_live_processes(process_filter: str = None,
                             db: Session = Depends(get_db)):
    """Получение процессов со всех машин в реальном времени"""
    try:
        machines = crud.get_machines(db)
        active_machines = [m for m in machines if m.is_active]

        all_processes = []

        # Собираем процессы параллельно
        tasks = []
        for machine in active_machines:
            task = ssh_manager.get_processes_from_machine(
                host=machine.address,
                port=machine.ssh_port,
                username=machine.username,
                password=machine.password,
                process_filter=process_filter
            )
            tasks.append((machine, asyncio.create_task(task)))

        # Ждем завершения всех задач
        for machine, task in tasks:
            try:
                processes = await task
                for process in processes:
                    process.update({
                        'machine_id': machine.id,
                        'machine_name': machine.name,
                        'machine_address': machine.address,
                        'machine_is_current': machine.is_current
                    })
                all_processes.extend(processes)
            except Exception as e:
                logger.error(
                    f"Error getting processes from {machine.name}: {e}")

        return {
            "count": len(all_processes),
            "processes": all_processes,
            "machines_scanned": len(active_machines)
        }

    except Exception as e:
        logger.error(f"Error getting live processes: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/processes/live/{machine_id}")
async def get_machine_live_processes(machine_id: int,
                                     process_filter: str = None,
                                     db: Session = Depends(get_db)):
    """Получение процессов с конкретной машины"""
    try:
        machine = crud.get_machine(db, machine_id)
        if not machine:
            raise HTTPException(status_code=404, detail="Machine not found")

        if not machine.is_active:
            return {
                "machine_id": machine_id,
                "machine_name": machine.name,
                "error": "Machine is offline",
                "processes": []
            }

        processes = await ssh_manager.get_processes_from_machine(
            host=machine.address,
            port=machine.ssh_port,
            username=machine.username,
            password=machine.password,
            process_filter=process_filter
        )

        # Добавляем информацию о машине
        for process in processes:
            process.update({
                'machine_id': machine.id,
                'machine_name': machine.name,
                'machine_address': machine.address
            })

        return {
            "machine_id": machine_id,
            "machine_name": machine.name,
            "process_count": len(processes),
            "processes": processes
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting machine processes: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/processes/kill/{machine_id}/{pid}")
async def kill_process_api(machine_id: int, pid: int, request: dict,
                           db: Session = Depends(get_db)):
    """Остановка процесса на машине"""
    try:
        machine = crud.get_machine(db, machine_id)
        if not machine:
            raise HTTPException(status_code=404, detail="Machine not found")

        if not machine.is_active:
            raise HTTPException(status_code=400, detail="Machine is offline")

        signal = request.get("signal", "TERM")  # TERM или KILL

        # Проверяем что процесс существует
        check_cmd = f"ps -p {pid} > /dev/null 2>&1 && echo 'exists' || echo 'not_found'"
        success, stdout, stderr = await ssh_manager.execute_command(
            host=machine.address,
            port=machine.ssh_port,
            username=machine.username,
            password=machine.password,
            command=check_cmd
        )

        if success and 'exists' in stdout:
            # Останавливаем процесс
            kill_cmd = f"kill -{signal} {pid}"
            success, stdout, stderr = await ssh_manager.execute_command(
                host=machine.address,
                port=machine.ssh_port,
                username=machine.username,
                password=machine.password,
                command=kill_cmd
            )

            if success:
                return {"success": True,
                        "message": f"Process {pid} killed with signal {signal}"}
            else:
                raise HTTPException(status_code=500,
                                    detail=f"Failed to kill process: {stderr}")
        else:
            raise HTTPException(status_code=404,
                                detail=f"Process {pid} not found")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error killing process: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/api/processes")
async def get_processes_api(db: Session = Depends(get_db)):
    processes = crud.get_processes(db)
    result = []
    for p in processes:
        result.append({
            "id": p.id,
            "machine_id": p.machine_id,
            "machine_name": p.machine.name if p.machine else f"Машина #{p.machine_id}",
            "script_id": p.script_id,
            "script_name": p.script.name if p.script else "Без сценария",
            "command": p.command,
            "status": p.status,
            "pid": p.pid,
            "started_at": p.started_at.isoformat() if p.started_at else None,
            "stopped_at": p.stopped_at.isoformat() if p.stopped_at else None
        })
    return result


@app.delete("/api/processes/{process_id}")
async def stop_process_api(process_id: int, db: Session = Depends(get_db)):
    try:
        process = crud.get_process(db, process_id)
        if not process:
            raise HTTPException(status_code=404, detail="Process not found")

        # Отмечаем процесс как остановленный в базе
        crud.update_process_status(db, process_id, "stopped")

        # Если есть машина и PID, пытаемся остановить процесс через SSH
        if process.machine_id and process.pid:
            machine = crud.get_machine(db, process.machine_id)
            if machine:
                await ssh_manager.kill_process(
                    machine.address, machine.ssh_port, machine.username,
                    machine.password,
                    process.pid
                )

        await manager.broadcast(
            json.dumps({"type": "update", "entity": "processes"}))
        return {"message": "Process stopped"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error stopping process: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/processes/batch-kill")
async def batch_kill_processes(request: dict, db: Session = Depends(get_db)):
    """Массовая остановка процессов"""
    try:
        process_list = request.get("processes", [])
        results = []

        for proc_info in process_list:
            machine_id = proc_info.get("machine_id")
            pid = proc_info.get("pid")

            if not machine_id or not pid:
                results.append({
                    "machine_id": machine_id,
                    "pid": pid,
                    "success": False,
                    "error": "Missing machine_id or pid"
                })
                continue

            machine = crud.get_machine(db, machine_id)
            if not machine:
                results.append({
                    "machine_id": machine_id,
                    "pid": pid,
                    "success": False,
                    "error": "Machine not found"
                })
                continue

            try:
                # Останавливаем процесс
                kill_cmd = f"kill -TERM {pid}"
                success, stdout, stderr = await ssh_manager.execute_command(
                    host=machine.address,
                    port=machine.ssh_port,
                    username=machine.username,
                    password=machine.password,
                    command=kill_cmd
                )

                results.append({
                    "machine_id": machine_id,
                    "pid": pid,
                    "success": success,
                    "error": stderr if not success else None
                })

            except Exception as e:
                results.append({
                    "machine_id": machine_id,
                    "pid": pid,
                    "success": False,
                    "error": str(e)
                })

        success_count = len([r for r in results if r["success"]])
        total_count = len(results)

        return {
            "total": total_count,
            "successful": success_count,
            "failed": total_count - success_count,
            "results": results
        }

    except Exception as e:
        logger.error(f"Error in batch kill: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    

# Process View Settings API
@app.get("/api/process-view-setting")
async def get_process_view_setting_api(db: Session = Depends(get_db)):
    setting = crud.get_process_view_setting(db)
    return {"regex_pattern": setting.regex_pattern}

@app.put("/api/process-view-setting")
async def update_process_view_setting_api(
    request: dict,
    db: Session = Depends(get_db)
):
    regex_pattern = request.get("regex_pattern", ".*")
    setting = crud.update_process_view_setting(db, regex_pattern)
    return {"regex_pattern": setting.regex_pattern}


# WebSocket endpoint
@app.websocket("/ws/updates")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Обрабатываем входящие сообщения, если нужно
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)


@app.on_event("shutdown")
async def shutdown():
    try:
        await ssh_manager.close_all()
        logger.info("SSH connections closed on shutdown")
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")


# HTML страницы
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("machines.html", {"request": request})


@app.get("/machines", response_class=HTMLResponse)
async def machines_page(request: Request):
    return templates.TemplateResponse("machines.html", {"request": request})


@app.get("/processes", response_class=HTMLResponse)
async def processes_page(request: Request):
    return templates.TemplateResponse("processes.html", {"request": request})


@app.get("/scripts", response_class=HTMLResponse)
async def scripts_page(request: Request):
    return templates.TemplateResponse("scripts.html", {"request": request})


@app.get("/profiles", response_class=HTMLResponse)
async def profiles_page(request: Request):
    return templates.TemplateResponse("profiles.html", {"request": request})


@app.get("/users", response_class=HTMLResponse)
async def users_page(request: Request):
    return templates.TemplateResponse("users.html", {"request": request})


# API для текущей машины
@app.get("/api/current-machine")
async def get_current_machine_info(db: Session = Depends(get_db)):
    try:
        current_address = ssh_manager.get_current_machine_address()
        machine = crud.get_machine_by_address(db, current_address)

        if machine:
            return {
                "exists": True,
                "machine": {
                    "id": machine.id,
                    "name": machine.name,
                    "address": machine.address,
                    "is_current": machine.is_current
                }
            }
        else:
            return {
                "exists": False,
                "address": current_address
            }
    except Exception as e:
        logger.error(f"Error getting current machine info: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/add-current-machine")
async def add_current_machine(machine_data: dict,
                              db: Session = Depends(get_db)):
    try:
        current_address = ssh_manager.get_current_machine_address()

        # Проверяем, нет ли уже такой машины
        existing = crud.get_machine_by_address(db, current_address)
        if existing:
            raise HTTPException(status_code=400,
                                detail="Current machine already exists")

        # Добавляем текущую машину
        machine_data["address"] = current_address
        machine_data["is_current"] = True

        db_machine = crud.create_machine(db, machine_data)
        await manager.broadcast(
            json.dumps({"type": "update", "entity": "machines"}))
        return db_machine
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding current machine: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# Health check
@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.datetime.now().isoformat()}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")