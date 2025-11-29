from __future__ import annotations

from fastapi import (
    FastAPI,
    UploadFile,
    Form,
    File,
    Depends,
    HTTPException,
    status,
    Request,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from google.genai import Client, types, errors as genai_errors
from dotenv import load_dotenv
from typing import Optional
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from pydantic import BaseModel
import asyncio
import os

from .database import Base, engine, SessionLocal
from . import models, schemas

# === CONFIGURACIÓN BASE / ENV ===
load_dotenv()
Base.metadata.create_all(bind=engine)

# --- API KEY GEMINI ---
_api_key = os.getenv("GEMINI_API_KEY")
if not _api_key:
    raise RuntimeError("❌ Error: GEMINI_API_KEY no está definida en el archivo .env")
API_KEY: str = _api_key

# --- CONFIG JWT / AUTH ---
SECRET_KEY: str = os.getenv("SECRET_KEY") or "super_secret"
ALGORITHM: str = os.getenv("ALGORITHM") or "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
    os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES") or "1440"
)

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

app = FastAPI()

# === FRONTEND / ESTÁTICOS ===
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")

# /static -> JS, CSS, imágenes
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/", include_in_schema=False)
async def serve_index():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    return FileResponse(index_path)

@app.get("/login", include_in_schema=False)
async def serve_login():
    login_path = os.path.join(FRONTEND_DIR, "login.html")
    return FileResponse(login_path)

# === CORS ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === GEMINI CLIENT ===
client = Client(api_key=API_KEY)

# === DEPENDENCIAS DB Y AUTH ===
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(
    request: Request, db: Session = Depends(get_db)
) -> models.User:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token faltante"
        )

    token = auth_header.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: Optional[str] = payload.get("sub")
        if username is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido"
            )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido"
        )

    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario no encontrado"
        )

    return user

# === Pydantic para títulos ===
class TitleRequest(BaseModel):
    user_message: str
    assistant_message: Optional[str] = None

class TitleResponse(BaseModel):
    title: str

# === AUTH ===
@app.post("/auth/register", response_model=schemas.Token)
def register(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    existing = (
        db.query(models.User)
        .filter(models.User.username == user_in.username)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="El usuario ya existe")

    user = models.User(
        username=user_in.username,
        email=user_in.email,
        password_hash=hash_password(user_in.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token({"sub": user.username})
    return schemas.Token(access_token=access_token, user=user)

@app.post("/auth/login", response_model=schemas.Token)
def login(user_in: schemas.UserLogin, db: Session = Depends(get_db)):
    user = (
        db.query(models.User)
        .filter(models.User.username == user_in.username)
        .first()
    )
    if not user or not verify_password(user_in.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Credenciales inválidas")

    access_token = create_access_token({"sub": user.username})
    return schemas.Token(access_token=access_token, user=user)

# === HELPERS PARA CONVERSACIONES ===


def get_or_create_conversation(
    db: Session, conv_id: str, user: models.User
) -> models.Conversation:
    conv = (
        db.query(models.Conversation)
        .filter_by(id=conv_id, user_id=user.id)
        .first()
    )
    if not conv:
        conv = models.Conversation(
            id=conv_id,
            user_id=user.id,
            title="Nueva Receta",
        )
        db.add(conv)
        db.commit()
        db.refresh(conv)
    return conv


def guardar_mensajes_db(
    db: Session,
    conv: models.Conversation,
    user_message: str,
    bot_response: str,
):
    msg_user = models.Message(
        conversation_id=conv.id,
        role=models.RoleEnum.user,
        content=user_message,
    )
    msg_bot = models.Message(
        conversation_id=conv.id,
        role=models.RoleEnum.assistant,
        content=bot_response,
    )
    db.add_all([msg_user, msg_bot])
    db.commit()


def cargar_historial_db(db: Session, conv_id: str, user: models.User):
    conv = (
        db.query(models.Conversation)
        .filter(
            models.Conversation.id == conv_id,
            models.Conversation.user_id == user.id,
        )
        .first()
    )
    if not conv:
        return []

    msgs = (
        db.query(models.Message)
        .filter(models.Message.conversation_id == conv.id)
        .order_by(models.Message.created_at.asc())
        .all()
    )
    history = []
    for m in msgs:
        if m.role == models.RoleEnum.user:
            history.append({"user": m.content, "bot": None})
        else:
            if history and history[-1]["bot"] is None:
                history[-1]["bot"] = m.content
            else:
                history.append({"user": "", "bot": m.content})
    return [h for h in history if h["user"] or h["bot"]]


# === ENDPOINT PRINCIPAL CON STREAMING Y HEARTBEAT ===


@app.post("/stream_chat/")
async def stream_chat(
    user_message: str = Form(...),
    conversation_id: str = Form(...),
    image: Optional[UploadFile] = File(None),
    username: str = Form("invitado"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    historial = cargar_historial_db(db, conversation_id, current_user)
    contents = []

    # 1. Historial previo
    for item in historial:
        if item["user"]:
            contents.append(
                types.Content(
                    role="user",
                    parts=[types.Part(text=item["user"])],
                )
            )
        if item["bot"]:
            contents.append(
                types.Content(
                    role="model",
                    parts=[types.Part(text=item["bot"])],
                )
            )

    # 2. Mensaje actual con imagen
    user_parts = []

    if image is not None and image.filename:
        image_bytes = await image.read()
        if image_bytes:
            mime_type = image.content_type or "application/octet-stream"
            user_parts.append(
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=mime_type,
                )
            )

    user_parts.append(types.Part(text=f"Usuario {username} dice: {user_message}"))
    contents.append(types.Content(role="user", parts=user_parts))

    # 3. System prompt
    system_prompt = (
        f"Eres un asistente de cocina con un estilo futurista y amigable. "
        f"Tu usuario se llama {username}. "
        "Tu única especialidad y área de conocimiento es la cocina, recetas, "
        "ingredientes, técnicas culinarias, nutrición relacionada con la comida "
        "y utensilios de cocina. "
        "Responde siempre con entusiasmo, emojis y lenguaje claro. "
        "**Formatea siempre tus recetas con títulos en negrita y listas de Markdown.** "
        "Si el usuario te da una imagen de ingredientes, analízala y úsala para sugerir recetas. "
        "**Si la consulta del usuario NO está directamente relacionada con la cocina, recetas, "
        "ingredientes o temas culinarios, debes responder con la frase exacta: "
        "'Este es un tema que no manejo, mi especialidad es la cocina'.** "
        "No intentes responder a consultas sobre matemáticas, historia, programación "
        "o cualquier tema fuera de la cocina."
    )

    conv = get_or_create_conversation(db, conversation_id, current_user)

    async def generate_and_stream():
        full_response_text = ""
        loop = asyncio.get_event_loop()
        last_yield_time = loop.time()

        try:
            response_stream = client.models.generate_content_stream(
                model="gemini-2.5-flash-lite",
                config=types.GenerateContentConfig(system_instruction=system_prompt),
                contents=contents,
            )

            for chunk in response_stream:
                if chunk.text:
                    yield chunk.text
                    full_response_text += chunk.text
                    last_yield_time = loop.time()

                # heartbeat (por si hiciera falta)
                current_time = loop.time()
                if (current_time - last_yield_time) > 5.0:
                    yield " "

            # Guardar en DB sólo si hubo respuesta
            if full_response_text:
                await loop.run_in_executor(
                    None,
                    guardar_mensajes_db,
                    db,
                    conv,
                    user_message,
                    full_response_text,
                )

        except genai_errors.ServerError as e:
            # Errores tipo 503 del modelo
            print("Error del modelo Gemini:", repr(e))
            yield (
                "❌ El modelo de IA está sobrecargado o no disponible en este momento. "
                "Inténtalo de nuevo en unos segundos."
            )
        except Exception as e:
            # Cualquier otro error inesperado
            print("Error inesperado en generate_and_stream:", repr(e))
            yield (
                "❌ Ocurrió un error al generar la respuesta. "
                "Por favor, inténtalo de nuevo más tarde."
            )

    return StreamingResponse(generate_and_stream(), media_type="text/plain")


# === ENDPOINT PARA RENOMBRAR CONVERSACIONES ===


@app.post("/conversations/rename/")
async def rename_conversation(
    conversation_id: str = Form(...),
    new_title: str = Form(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    conv = (
        db.query(models.Conversation)
        .filter(
            models.Conversation.id == conversation_id,
            models.Conversation.user_id == current_user.id,
        )
        .first()
    )
    if not conv:
        return {"status": "error", "message": "Conversación no encontrada"}

    conv.title = new_title
    db.commit()
    return {"status": "success", "message": "Título actualizado"}

from fastapi import HTTPException

# ...

@app.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    conv = (
        db.query(models.Conversation)
        .filter(
            models.Conversation.id == conversation_id,
            models.Conversation.user_id == current_user.id,
        )
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")

    # Borrar mensajes primero (por si no tienes cascade)
    db.query(models.Message).filter(
        models.Message.conversation_id == conv.id
    ).delete(synchronize_session=False)

    db.delete(conv)
    db.commit()
    return {"status": "success"}



# === NUEVO ENDPOINT: SUGERIR TÍTULO CON IA ===


@app.post("/conversations/suggest_title/", response_model=TitleResponse)
async def suggest_title(
    payload: TitleRequest,
    current_user: models.User = Depends(get_current_user),
):
    """
    Devuelve un título breve y creativo para un chat de recetas
    en español (máx ~8 palabras), usando Gemini.
    """
    user_msg = (payload.user_message or "").strip()
    assistant_msg = (payload.assistant_message or "").strip()

    prompt = f"""
Eres un asistente que pone nombres creativos a conversaciones de cocina.

Genera un título breve, claro y atractivo en español (máximo 8 palabras)
para una conversación de recetas de cocina. El título debe sonar como
un nombre de chat, por ejemplo:
- "Desayuno casero con huevos"
- "Almuerzo rápido con pollo"
- "Cena sencilla de pasta"
- "Ideas con arroz y verduras"

NO expliques nada, responde SOLO con el título.

Mensaje del usuario:
\"\"\"{user_msg}\"\"\"

Respuesta del asistente:
\"\"\"{assistant_msg}\"\"\"
"""

    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents=[
            types.Content(
                role="user",
                parts=[types.Part(text=prompt)],
            )
        ],
    )

    raw = (response.text or "").strip()
    if not raw:
        return TitleResponse(title="Nueva Receta")

    # Limpiar prefijos como "Título: ..." y comillas
    clean = raw.replace("\n", " ").strip()
    if clean.lower().startswith("título:") or clean.lower().startswith("titulo:"):
        clean = clean.split(":", 1)[1].strip()
    clean = clean.strip(' "“”')

    if not clean:
        clean = "Nueva Receta"

    return TitleResponse(title=clean)


# === ENDPOINTS DE LECTURA ===


@app.get("/conversations/")
def get_conversations(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    convs = (
        db.query(models.Conversation)
        .filter(models.Conversation.user_id == current_user.id)
        .order_by(models.Conversation.updated_at.desc())
        .all()
    )

    conversations_list = []
    for conv in convs:
        title = conv.title or "Nueva Receta"
        title_clean = (
            title.split("\n")[0]
            .strip()
            .replace("**", "")
            .split("!")[0]
            .replace("🍳", "")
            .replace("👋", "")
            .strip()
        )
        if len(title_clean) > 50:
            title_clean = title_clean[:50] + "..."

        conversations_list.append(
            {
                "id": conv.id,
                "title": title_clean or "Nueva Receta",
                "username": current_user.username,
            }
        )

    return {"conversations": conversations_list}


@app.get("/history/{conversation_id}")
def get_history(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    conv = (
        db.query(models.Conversation)
        .filter(
            models.Conversation.id == conversation_id,
            models.Conversation.user_id == current_user.id,
        )
        .first()
    )
    if not conv:
        return {
            "conversation_id": conversation_id,
            "history": [],
            "username": current_user.username,
        }

    msgs = (
        db.query(models.Message)
        .filter(models.Message.conversation_id == conv.id)
        .order_by(models.Message.created_at.asc())
        .all()
    )

    history = []
    for m in msgs:
        history.append(
            {
                "role": m.role.value,
                "content": m.content,
                "created_at": m.created_at.isoformat(),
            }
        )

    # Adaptar al formato que ya usas en el frontend (user/bot)
    paired = []
    user_buffer: Optional[str] = None
    for m in history:
        if m["role"] == "user":
            user_buffer = m["content"]
        else:
            paired.append({"user": user_buffer or "", "bot": m["content"]})
            user_buffer = None

    return {
        "conversation_id": conversation_id,
        "history": paired,
        "username": current_user.username,
    }


@app.get("/")
def root():
    return {"message": "🚀 Asistente de cocina futurista activo con usuarios."}