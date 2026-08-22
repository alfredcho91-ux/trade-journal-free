from fastapi.testclient import TestClient

from backend.main import app


def test_credential_validation_error_does_not_echo_secret():
    secret = "sensitive-value-" * 50
    response = TestClient(app).post(
        "/api/exchanges/deepcoin/credentials",
        json={"api_key": "api", "secret_key": secret, "passphrase": "pass"},
    )

    assert response.status_code == 422
    assert secret not in response.text
    assert response.json()["error_code"] == "VALIDATION_ERROR"
