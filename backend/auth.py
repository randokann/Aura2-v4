import os
from fastapi import HTTPException, Header
from jose import jwt, JWTError
import requests


SUPABASE_URL = os.environ.get("SUPABASE_URL")


async def get_current_user(
    authorization: str = Header(None)
):
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Missing authorization header"
        )

    try:
        token = authorization.replace("Bearer ", "")

        # Recuperiamo la chiave pubblica JWT di Supabase
        jwks = requests.get(
            f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
        ).json()

        header = jwt.get_unverified_header(token)

        key = None

        for k in jwks["keys"]:
            if k["kid"] == header["kid"]:
                key = k
                break

        if not key:
            raise Exception("JWT key not found")

        payload = jwt.decode(
            token,
            key,
            algorithms=["ES256"],
            audience="authenticated"
        )

        return {
            "id": payload["sub"],
            "email": payload.get("email")
        }

    except JWTError:
        raise HTTPException(
            status_code=401,
            detail="Invalid token"
        )