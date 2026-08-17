from __future__ import annotations

import logging
import socket
from typing import List, Optional

import httpx
from google import genai

from .base import (
    AIProvider,
    AIProviderError,
    AIResponseFormatError,
    AIUpstreamConnectionError,
    extract_json,
)

logger = logging.getLogger(__name__)


def _is_connectivity_error(error: BaseException) -> bool:
    """Recognize failures that occurred before Gemini returned an HTTP response."""
    current: Optional[BaseException] = error
    seen: set[int] = set()
    connectivity_types = (
        httpx.ConnectError,
        httpx.ConnectTimeout,
        socket.gaierror,
        ConnectionError,
    )

    while current is not None and id(current) not in seen:
        if isinstance(current, connectivity_types):
            return True
        seen.add(id(current))
        current = current.__cause__ or current.__context__

    return False


class GeminiProvider(AIProvider):
    """
    Direct Google Gemini API provider.
    No Emergent dependency.
    """

    def __init__(self, api_key: str, model: str = "gemini-flash-latest"):
        if not api_key:
            raise AIProviderError("Empty GOOGLE_API_KEY")

        self._client = genai.Client(api_key=api_key)
        self._model = model

    async def json_completion(
        self,
        *,
        system: str,
        prompt: str,
        images_base64: Optional[List[str]] = None,
        temperature: float = 0.6,
        max_retries: int = 1,
    ) -> dict:

        contents = []

        if images_base64:
            for image in images_base64[:8]:
                contents.append({
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": image,
                    }
                })

        contents.append(prompt)

        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=contents,
                config={
                    "system_instruction": system,
                    "temperature": temperature,
                    "response_mime_type": "application/json",
                },
            )

            return extract_json(response.text)

        except AIResponseFormatError:
            raise
        except Exception as e:
            logger.exception("Gemini API error")
            if _is_connectivity_error(e):
                raise AIUpstreamConnectionError(
                    "Could not establish a network connection to Gemini"
                ) from e
            raise AIProviderError(f"Gemini failed: {str(e)}") from e
