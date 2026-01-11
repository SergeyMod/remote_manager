from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, \
    Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import json


class Machine(Base):
    __tablename__ = "machines"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    address = Column(String, unique=True, nullable=False)
    ssh_port = Column(Integer, default=22)
    username = Column(String, nullable=False)
    password = Column(String, nullable=False)
    is_current = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    last_checked = Column(DateTime, default=func.now())
    created_at = Column(DateTime, default=func.now())

    processes = relationship("Process", back_populates="machine")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    password = Column(String, nullable=False)
    created_at = Column(DateTime, default=func.now())


class Script(Base):
    __tablename__ = "scripts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    profile_scripts = relationship("ProfileScript", back_populates="script")


class Profile(Base):
    __tablename__ = "profiles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=func.now())

    profile_scripts = relationship("ProfileScript", back_populates="profile")


class ProfileScript(Base):
    __tablename__ = "profile_scripts"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("profiles.id"))
    script_id = Column(Integer, ForeignKey("scripts.id"))
    machine_ids = Column(String, default="[]")  # JSON массив ID машин
    order_index = Column(Integer, default=0)

    profile = relationship("Profile", back_populates="profile_scripts")
    script = relationship("Script", back_populates="profile_scripts")

    def get_machine_ids(self):
        return json.loads(self.machine_ids) if self.machine_ids else []

    def set_machine_ids(self, ids):
        self.machine_ids = json.dumps(ids)


# class Process(Base):
#     __tablename__ = "processes"
#
#     id = Column(Integer, primary_key=True, index=True)
#     machine_id = Column(Integer, ForeignKey("machines.id"))
#     script_id = Column(Integer, ForeignKey("scripts.id"), nullable=True)
#     pid = Column(Integer, nullable=True)
#     command = Column(String, nullable=False)
#     status = Column(String, default="running")  # running, stopped, error
#     started_at = Column(DateTime, default=func.now())
#     stopped_at = Column(DateTime, nullable=True)
#
#     machine = relationship("Machine", back_populates="processes")
#     script = relationship("Script")