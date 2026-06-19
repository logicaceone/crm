from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import settings

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        # Roll back any in-flight transaction so the session is not left
        # in a poisoned state. Then re-raise — FastAPI's exception handler
        # will translate the error for the client.
        db.rollback()
        raise
    finally:
        db.close()
