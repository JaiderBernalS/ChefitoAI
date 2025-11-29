from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# 🔹 Usar SIEMPRE SQLite (tanto local como en Railway)
# El archivo se llamará chefito.db y quedará en la raíz del proyecto (/app/chefito.db en Railway)
DATABASE_URL = "sqlite:///./chefito.db"

# Engine para SQLite (ojo con connect_args)
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

# Sesión de SQLAlchemy
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Base para los modelos
Base = declarative_base()