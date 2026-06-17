from cryptography.fernet import Fernet
from .config import settings


def _fernet() -> Fernet:
    key = settings.fernet_key
    if not key:
        raise RuntimeError("FERNET_KEY is not configured")
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_token(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_token(encrypted: str) -> str:
    return _fernet().decrypt(encrypted.encode()).decode()
