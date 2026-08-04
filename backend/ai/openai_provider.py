from __future__ import annotations

import base64
import json
import os

from openai import AsyncOpenAI

from .base import AIProvider, AIProviderError


class OpenAIProvider(AIProvider):
    def __init__(self):
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise AIProviderError("OPENAI_API_KEY not found")

        self.client = AsyncOpenAI(api_key=api_key)

    async def json_completion(
        self,
        *,
        system: str,
        prompt: str,
        images_base64=None,
        temperature: float = 0.4,
        max_retries: int = 1,
    ) -> dict:

        content = [
            {
                "type": "input_text",
                "text": prompt,
            }
        ]

        if images_base64:
            for img in images_base64:
                content.append(
                    {
                        "type": "input_image",
                        "image_url": f"data:image/jpeg;base64,{img}",
                    }
                )

        try:
            response = await self.client.responses.create(
                model="gpt-4.1-mini",
                temperature=temperature,
                input=[
                    {
                        "role": "system",
                        "content": system,
                    },
                    {
                        "role": "user",
                        "content": content,
                    },
                ],
            )

            text = response.output_text

            return json.loads(text)

        except Exception as e:
            raise AIProviderError(str(e))
