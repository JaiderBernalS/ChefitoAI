from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
# === USER ===

class UserBase(BaseModel):
    username: str
    email: Optional[EmailStr] = None


class UserCreate(UserBase):
    password: str = Field(..., min_length=6, max_length=64)


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(UserBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# === TOKEN ===

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut