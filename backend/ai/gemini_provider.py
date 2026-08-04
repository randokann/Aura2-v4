from __future__ import annotations

import logging
from typing import List, Optional

from google import genai

from .base import AIProvider, AIProviderError, extract_json

logger = logging.getLogger(__name__)


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

        except Exception as e:
            logger.exception("Gemini API error")
            raise AIProviderError(f"Gemini failed: {str(e)}")
