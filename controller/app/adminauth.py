"""Autenticación del panel: usuario + contraseña con sesiones.

- La contraseña se guarda cifrada con PBKDF2-HMAC-SHA256 (stdlib, sin dependencias).
- Al iniciar sesión se emite un token de sesión aleatorio (`sk_…`); en BD solo se
  guarda su hash SHA-256, con caducidad. Es revocable.
- El `ADMIN_TOKEN` del entorno sigue siendo válido como llave de emergencia
  (romper-cristal): permite entrar aunque se olvide la contraseña.
"""
import hashlib
import os
import secrets
import time
from datetime import datetime, timedelta, timezone

import asyncpg

from aihub_kit.errors import ApiError

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
PBKDF2_ITERATIONS = 200_000

# Rate limit del login en memoria: máx. intentos fallidos por usuario/ventana.
_MAX_FAILS = 8
_WINDOW_S = 300.0
_fails: dict[str, list[float]] = {}


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS)
    return dk.hex(), salt


def verify_password(password: str, salt: str, expected_hex: str) -> bool:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS)
    return secrets.compare_digest(dk.hex(), expected_hex)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def seed_admin(pool: asyncpg.Pool) -> None:
    """Crea el usuario administrador inicial si no existe ninguno.
    Toma usuario/contraseña de ADMIN_USERNAME/ADMIN_PASSWORD del entorno."""
    n = await pool.fetchval("SELECT count(*) FROM admin_users")
    if n:
        return
    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD")
    if not password:
        return  # sin contraseña inicial se entra solo con el token de emergencia
    pwd_hash, salt = hash_password(password)
    await pool.execute(
        "INSERT INTO admin_users (username, password_hash, password_salt) VALUES ($1,$2,$3)",
        username, pwd_hash, salt,
    )


def _check_rate_limit(username: str) -> None:
    now = time.monotonic()
    fails = [t for t in _fails.get(username, []) if now - t < _WINDOW_S]
    _fails[username] = fails
    if len(fails) >= _MAX_FAILS:
        raise ApiError(429, "rate_limited",
                       "Demasiados intentos fallidos. Espera unos minutos.")


def _record_fail(username: str) -> None:
    _fails.setdefault(username, []).append(time.monotonic())


async def login(pool: asyncpg.Pool, username: str, password: str) -> dict:
    username = (username or "").strip()
    _check_rate_limit(username)
    row = await pool.fetchrow("SELECT * FROM admin_users WHERE username=$1", username)
    if row is None or not verify_password(password, row["password_salt"], row["password_hash"]):
        _record_fail(username)
        raise ApiError(401, "invalid_credentials", "Usuario o contraseña incorrectos")
    _fails.pop(username, None)
    token = "sk_" + secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    await pool.execute(
        "INSERT INTO admin_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)",
        _token_hash(token), row["id"], expires,
    )
    return {"token": token, "username": username, "expires_at": expires.isoformat()}


async def logout(pool: asyncpg.Pool, token: str) -> None:
    await pool.execute("DELETE FROM admin_sessions WHERE token_hash=$1", _token_hash(token))


async def resolve(pool: asyncpg.Pool, token: str) -> dict | None:
    """Devuelve {user_id, username} si el token es una sesión válida, el token de
    emergencia, o None. Renueva last_used y limpia sesiones caducadas."""
    if not token:
        return None
    if ADMIN_TOKEN and secrets.compare_digest(token.encode(), ADMIN_TOKEN.encode()):
        return {"user_id": 0, "username": "root (token)"}
    row = await pool.fetchrow(
        """SELECT s.user_id, u.username, s.expires_at
           FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
           WHERE s.token_hash=$1""",
        _token_hash(token),
    )
    if row is None:
        return None
    if row["expires_at"] < datetime.now(timezone.utc):
        await pool.execute("DELETE FROM admin_sessions WHERE token_hash=$1", _token_hash(token))
        return None
    await pool.execute(
        "UPDATE admin_sessions SET last_used_at=now() WHERE token_hash=$1", _token_hash(token)
    )
    return {"user_id": row["user_id"], "username": row["username"]}


async def change_password(
    pool: asyncpg.Pool, user_id: int, current: str, new: str
) -> None:
    if len(new) < 8:
        raise ApiError(400, "invalid_request", "La nueva contraseña debe tener al menos 8 caracteres")
    if user_id == 0:
        raise ApiError(400, "invalid_request",
                       "Estás usando el token de emergencia; no hay contraseña que cambiar")
    row = await pool.fetchrow("SELECT * FROM admin_users WHERE id=$1", user_id)
    if row is None or not verify_password(current, row["password_salt"], row["password_hash"]):
        raise ApiError(403, "forbidden", "La contraseña actual no es correcta")
    pwd_hash, salt = hash_password(new)
    await pool.execute(
        "UPDATE admin_users SET password_hash=$1, password_salt=$2, updated_at=now() WHERE id=$3",
        pwd_hash, salt, user_id,
    )
    # invalida el resto de sesiones del usuario tras cambiar la contraseña
    await pool.execute("DELETE FROM admin_sessions WHERE user_id=$1", user_id)
