from __future__ import annotations

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Cargar variables de entorno desde .env
load_dotenv()

# Si no hay DATABASE_URL en .env, usa sqlite por defecto (útil para pruebas)
DATABASE_URL = os.getenv("DATABASE_URL") or "sqlite:///./chefito.db"

# Crear engine según el tipo de base de datos
if DATABASE_URL.startswith("sqlite"):
    # Config especial para SQLite (necesita este connect_args)
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False}
    )
else:
    # Para MySQL (y otros motores) no se necesita connect_args
    # Ejemplo en .env:
    # DATABASE_URL=mysql+mysqlconnector://usuario:password@localhost:3306/asistente_cocina
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True  # ayuda a evitar conexiones muertas
    )

# Sesión de SQLAlchemy
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Base para los modelos
Base = declarative_base()