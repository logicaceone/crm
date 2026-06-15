from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from alembic.config import Config as AlembicConfig
from alembic import command as alembic_command
from passlib.context import CryptContext

from .config import settings
from .database import SessionLocal
from .models.user import User, UserRole
from .routers import auth


def _run_migrations() -> None:
    cfg = AlembicConfig("alembic.ini")
    alembic_command.upgrade(cfg, "head")


def _seed_admin() -> None:
    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == "admin").first():
            return
        pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
        db.add(User(
            username="admin",
            password_hash=pwd.hash("admin"),
            role=UserRole.admin,
        ))
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _run_migrations()
    _seed_admin()
    yield


app = FastAPI(title="CRM API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)


@app.get("/health")
def health():
    return {"status": "ok"}
