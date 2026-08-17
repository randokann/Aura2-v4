"""Abstract AI provider contract + shared error type + JSON extraction helper.

Any concrete AI provider (Gemini, OpenAI, Anthropic, local Llama, …) must
implement `AIProvider.json_completion`. Everything above this layer never
imports the concrete SDK directly.
"""
from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from typing import List, Optional


class AIProviderError(Exception):
    """Raised when the underlying AI provider fails (network, quota, invalid JSON)."""


class AIUpstreamConnectionError(AIProviderError):
    """Raised when no network connection can be established to the AI provider."""


class AIResponseFormatError(AIProviderError):
    """Raised when a provider response cannot be parsed as the requested JSON."""


class AIProvider(ABC):
    """Contract every AI backend must implement."""

    @abstractmethod
    async def json_completion(
        self,
        *,
        system: str,
        prompt: str,
        images_base64: Optional[List[str]] = None,
        temperature: float = 0.6,
        max_retries: int = 1,
    ) -> dict:
        """Send a system + user prompt (optionally with images) and return a parsed JSON dict.

        Args:
            system: system-level instructions for the model.
            prompt: user prompt text. Should ask for a JSON reply.
            images_base64: optional list of base64-encoded image strings.
            temperature: sampling temperature (0.0-1.0).
            max_retries: number of extra attempts on transient failures.

        Returns:
            dict parsed from the model's JSON response.

        Raises:
            AIProviderError on unrecoverable failure.
        """


def extract_json(text: str) -> dict:
    """Best-effort extraction of a JSON object from a model's raw text response."""
    text = (text or "").strip()
    try:
        # Prefer fenced ```json blocks
        fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if fence:
            return json.loads(fence.group(1))
        # Fallback to first top-level object
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise AIResponseFormatError(f"Invalid JSON response: {text[:200]}") from exc
    raise AIResponseFormatError(f"No JSON found in response: {text[:200]}")
