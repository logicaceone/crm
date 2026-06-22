"""Rate limiter shared between main.py and routers.

A single Limiter instance must back both the FastAPI app state and any
@limiter.limit(...) decorators on routes — keeping it in its own module
avoids a circular import between main.py and routers/auth.py.

The IP key is read from X-Forwarded-For when present (we sit behind
nginx, which strips/adds the header from a trusted boundary). If the
header is missing we fall back to the socket peer — handy in local
dev and tests where there's no proxy.
"""
from fastapi import Request
from slowapi import Limiter


def get_real_ip(request: Request) -> str:
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # X-Forwarded-For is "client, proxy1, proxy2" — the leftmost
        # value is the originating client as recorded by the first
        # trusted proxy.
        return forwarded_for.split(",")[0].strip()
    if request.client is not None:
        return request.client.host
    return "unknown"


limiter = Limiter(key_func=get_real_ip)
