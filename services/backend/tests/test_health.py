"""Verify health responses and browser access from the local frontend."""

import json
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_response(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.headers["X-Contract-Version"] == "2.0.0"
    body = response.json()
    assert set(body) == {"data", "request_id"}
    assert body["data"] == {
        "status": "ok",
        "service": "backend",
        "contract_version": "2.0.0",
    }
    assert UUID(body["request_id"]).version == 4


def test_health_generates_a_new_request_id(client):
    first = client.get("/health").json()["request_id"]
    second = client.get("/health").json()["request_id"]

    assert first != second


def test_health_allows_local_frontend(client):
    response = client.get("/health", headers={"Origin": "http://localhost:3000"})

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
    assert "X-Contract-Version" in response.headers["Access-Control-Expose-Headers"]


def test_health_allows_frontend_preflight(client):
    response = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
    assert "GET" in response.headers["Access-Control-Allow-Methods"]
    assert response.headers["X-Contract-Version"] == "2.0.0"


def test_health_does_not_allow_other_origins(client):
    response = client.get("/health", headers={"Origin": "https://example.com"})

    assert "Access-Control-Allow-Origin" not in response.headers


def test_health_matches_repository_contract(client):
    repository_root = Path(__file__).resolve().parents[3]
    candidates = (
        repository_root / "contracts" / "backend.openapi.json",
        repository_root / "front" / "contracts" / "backend.openapi.json",
    )
    contract_path = next((path for path in candidates if path.is_file()), None)
    if contract_path is None:
        pytest.skip("No repository health contract available; response shape tested separately")

    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    assert contract["info"]["version"] == "2.0.0"
    schema = {
        "$ref": "#/components/schemas/HealthEnvelope",
        "components": contract["components"],
    }
    Draft202012Validator(schema).validate(client.get("/health").json())
