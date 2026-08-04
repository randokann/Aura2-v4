"""AI subsystem entrypoint.

Application code imports `get_ai_service()` from here and receives a fully
wired `AIService`. The concrete provider is chosen at process startup based on
the `AI_PROVIDER` env var. To add a new provider:

    1. implement `AIProvider` in a new module (`ai/<name>_provider.py`)
    2. register it in `_build_provider` below

No callers of `get_ai_service()` need to change.
"""
from __future__ import annotations

import os
from functools import lru_cache

from .base import AIProvider, AIProviderError
from .service import AIService

__all__ = ["get_ai_service", "AIProvider", "AIProviderError", "AIService"]


def _build_provider() -> AIProvider:
    name = os.environ.get("AI_PROVIDER", "gemini").lower()
    if name == "gemini":
        from .gemini_provider import GeminiProvider
        key = os.environ.get("GOOGLE_API_KEY", "")
        model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        return GeminiProvider(api_key=key, model=model)
    # Future providers register here:
    # if name == "openai": from .openai_provider import OpenAIProvider; return OpenAIProvider(...)
    # if name == "llama":  from .llama_provider  import LlamaProvider;  return LlamaProvider(...)
    raise AIProviderError(f"Unknown AI_PROVIDER: {name}")


@lru_cache(maxsize=1)
def get_ai_service() -> AIService:
    """Singleton factory. First call builds provider + service; subsequent calls reuse."""
    return AIService(_build_provider())
