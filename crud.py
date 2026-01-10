from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
import models
import datetime
import json


# Machine CRUD operations
def get_machines(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Machine).offset(skip).limit(limit).all()


def get_machine(db: Session, machine_id: int):
    return db.query(models.Machine).filter(
        models.Machine.id == machine_id).first()


def get_machine_by_address(db: Session, address: str):
    return db.query(models.Machine).filter(
        models.Machine.address == address).first()


def create_machine(db: Session, machine_data: dict):
    db_machine = models.Machine(**machine_data)
    db.add(db_machine)
    db.commit()
    db.refresh(db_machine)
    return db_machine


def update_machine(db: Session, machine_id: int, machine_data: dict):
    db_machine = get_machine(db, machine_id)
    if db_machine:
        for key, value in machine_data.items():
            setattr(db_machine, key, value)
        db_machine.last_checked = datetime.datetime.now()
        db.commit()
        db.refresh(db_machine)
    return db_machine


def delete_machine(db: Session, machine_id: int):
    db_machine = get_machine(db, machine_id)
    if db_machine:
        db.delete(db_machine)
        db.commit()
    return db_machine


def update_machine_status(db: Session, machine_id: int, is_active: bool):
    db_machine = get_machine(db, machine_id)
    if db_machine:
        db_machine.is_active = is_active
        db_machine.last_checked = datetime.datetime.now()
        db.commit()
        db.refresh(db_machine)
    return db_machine


def set_current_machine(db: Session, address: str):
    # Сбрасываем флаг is_current у всех машин
    db.query(models.Machine).update({models.Machine.is_current: False})

    # Устанавливаем флаг текущей машине
    db_machine = get_machine_by_address(db, address)
    if db_machine:
        db_machine.is_current = True
        db.commit()
        db.refresh(db_machine)
    return db_machine


# User CRUD operations
def get_users(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.User).offset(skip).limit(limit).all()


def get_user(db: Session, user_id: int):
    return db.query(models.User).filter(models.User.id == user_id).first()


def get_user_by_username(db: Session, username: str):
    return db.query(models.User).filter(
        models.User.username == username).first()


def create_user(db: Session, user_data: dict):
    db_user = models.User(**user_data)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def update_user(db: Session, user_id: int, user_data: dict):
    db_user = get_user(db, user_id)
    if db_user:
        for key, value in user_data.items():
            setattr(db_user, key, value)
        db.commit()
        db.refresh(db_user)
    return db_user


def delete_user(db: Session, user_id: int):
    db_user = get_user(db, user_id)
    if db_user:
        db.delete(db_user)
        db.commit()
    return db_user


# Script CRUD operations
def get_scripts(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Script).offset(skip).limit(limit).all()


def get_script(db: Session, script_id: int):
    return db.query(models.Script).filter(
        models.Script.id == script_id).first()


def create_script(db: Session, script_data: dict):
    db_script = models.Script(**script_data)
    db.add(db_script)
    db.commit()
    db.refresh(db_script)
    return db_script


def update_script(db: Session, script_id: int, script_data: dict):
    db_script = get_script(db, script_id)
    if db_script:
        for key, value in script_data.items():
            setattr(db_script, key, value)
        db_script.updated_at = datetime.datetime.now()
        db.commit()
        db.refresh(db_script)
    return db_script


def delete_script(db: Session, script_id: int):
    db_script = get_script(db, script_id)
    if db_script:
        db.delete(db_script)
        db.commit()
    return db_script


# Profile CRUD operations
def get_profiles(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Profile).offset(skip).limit(limit).all()


def get_profile(db: Session, profile_id: int):
    return db.query(models.Profile).filter(
        models.Profile.id == profile_id).first()


def create_profile(db: Session, profile_data: dict):
    db_profile = models.Profile(**profile_data)
    db.add(db_profile)
    db.commit()
    db.refresh(db_profile)
    return db_profile


def update_profile(db: Session, profile_id: int, profile_data: dict):
    db_profile = get_profile(db, profile_id)
    if db_profile:
        for key, value in profile_data.items():
            setattr(db_profile, key, value)
        db.commit()
        db.refresh(db_profile)
    return db_profile


def delete_profile(db: Session, profile_id: int):
    db_profile = get_profile(db, profile_id)
    if db_profile:
        # Удаляем связанные ProfileScript записи
        db.query(models.ProfileScript).filter(
            models.ProfileScript.profile_id == profile_id
        ).delete()
        db.delete(db_profile)
        db.commit()
    return db_profile


# ProfileScript CRUD operations
def create_profile_script(db: Session, profile_script_data: dict):
    db_profile_script = models.ProfileScript(**profile_script_data)
    db.add(db_profile_script)
    db.commit()
    db.refresh(db_profile_script)
    return db_profile_script


def get_profile_scripts(db: Session, profile_id: int):
    return db.query(models.ProfileScript).filter(
        models.ProfileScript.profile_id == profile_id
    ).order_by(models.ProfileScript.order_index).all()


def delete_profile_scripts(db: Session, profile_id: int):
    db.query(models.ProfileScript).filter(
        models.ProfileScript.profile_id == profile_id
    ).delete()
    db.commit()


# Process CRUD operations
def get_processes(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Process).offset(skip).limit(limit).all()


def get_machine_processes(db: Session, machine_id: int):
    return db.query(models.Process).filter(
        models.Process.machine_id == machine_id,
        models.Process.status == "running"
    ).all()


def get_process(db: Session, process_id: int):
    return db.query(models.Process).filter(
        models.Process.id == process_id).first()


def create_process(db: Session, process_data: dict):
    db_process = models.Process(**process_data)
    db.add(db_process)
    db.commit()
    db.refresh(db_process)
    return db_process


def update_process_status(db: Session, process_id: int, status: str):
    db_process = get_process(db, process_id)
    if db_process:
        db_process.status = status
        if status == "stopped":
            db_process.stopped_at = datetime.datetime.now()
        db.commit()
        db.refresh(db_process)
    return db_process


def delete_process(db: Session, process_id: int):
    db_process = get_process(db, process_id)
    if db_process:
        db.delete(db_process)
        db.commit()
    return db_process


def stop_machine_processes(db: Session, machine_id: int):
    processes = db.query(models.Process).filter(
        models.Process.machine_id == machine_id,
        models.Process.status == "running"
    ).all()

    for process in processes:
        process.status = "stopped"
        process.stopped_at = datetime.datetime.now()

    db.commit()
    return len(processes)