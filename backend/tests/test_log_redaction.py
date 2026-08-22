from backend.utils.log_redaction import redact_text, register_sensitive_values


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
