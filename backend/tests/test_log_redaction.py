import logging

from uvicorn.logging import AccessFormatter

from backend.utils.log_redaction import (
    install_log_redaction,
    redact_text,
    register_sensitive_values,
)


def test_log_redaction_masks_labels_authorization_and_registered_values():
    register_sensitive_values("actual-secret-value")
    rendered = redact_text(
        "api_key=visible secret_key:another passphrase=third "
        "Authorization: Bearer abc.def actual-secret-value"
    )
    assert "visible" not in rendered
    assert "another" not in rendered
    assert "third" not in rendered
    assert "abc.def" not in rendered
    assert "actual-secret-value" not in rendered
    assert "[REDACTED]" in rendered


def test_log_redaction_preserves_uvicorn_access_log_arguments():
    install_log_redaction()
    factory = logging.getLogRecordFactory()
    record = factory(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:1234", "GET", "/api?api_key=visible", "1.1", 200),
        None,
    )

    rendered = AccessFormatter().format(record)

    assert len(record.args) == 5
    assert "visible" not in rendered
    assert "[REDACTED]" in rendered
