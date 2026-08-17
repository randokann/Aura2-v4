"""Focused AI upstream connectivity contract tests. No real Gemini calls."""

import asyncio
import socket
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from google.genai import errors as gemini_errors

from ai import AIProviderError, AIUpstreamConnectionError
from ai.gemini_provider import GeminiProvider
from server import _ai_error


def _provider_raising(error: Exception) -> GeminiProvider:
    provider = GeminiProvider.__new__(GeminiProvider)
    provider._model = "gemini-2.5-flash"
    provider._client = SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(generate_content=AsyncMock(side_effect=error))
        )
    )
    return provider


def _complete(provider: GeminiProvider):
    return asyncio.run(
        provider.json_completion(system="system", prompt="prompt", max_retries=0)
    )


def test_connect_error_becomes_upstream_unreachable_contract():
    request = httpx.Request("POST", "https://generativelanguage.googleapis.com")
    provider = _provider_raising(httpx.ConnectError("connection failed", request=request))

    with pytest.raises(AIUpstreamConnectionError) as caught:
        _complete(provider)

    response = _ai_error(caught.value, "Food analysis error")
    assert response.status_code == 503
    assert response.detail == {
        "code": "AI_UPSTREAM_UNREACHABLE",
        "message": "The AI service could not be reached over the network.",
    }


def test_dns_failure_becomes_upstream_unreachable():
    provider = _provider_raising(socket.gaierror(-2, "Name or service not known"))

    with pytest.raises(AIUpstreamConnectionError):
        _complete(provider)


def test_connect_timeout_becomes_upstream_unreachable():
    request = httpx.Request("POST", "https://generativelanguage.googleapis.com")
    provider = _provider_raising(httpx.ConnectTimeout("connect timed out", request=request))

    with pytest.raises(AIUpstreamConnectionError):
        _complete(provider)


def test_upstream_contract_survives_a_wrapped_service_error():
    upstream = AIUpstreamConnectionError("network unavailable")
    try:
        raise upstream
    except AIUpstreamConnectionError as exc:
        try:
            raise AIProviderError("repair failed") from exc
        except AIProviderError as wrapped:
            response = _ai_error(wrapped, "Meal plan error")

    assert response.status_code == 503
    assert response.detail["code"] == "AI_UPSTREAM_UNREACHABLE"


@pytest.mark.parametrize("status", [401, 403, 429, 500])
def test_provider_http_responses_are_not_upstream_connectivity_errors(status):
    error_type = gemini_errors.ClientError if status < 500 else gemini_errors.ServerError
    provider = _provider_raising(error_type(status, {"message": "provider response"}))

    with pytest.raises(AIProviderError) as caught:
        _complete(provider)

    assert not isinstance(caught.value, AIUpstreamConnectionError)
    response = _ai_error(caught.value, "Food analysis error")
    assert response.status_code == 502
    assert response.detail == "Food analysis error"
