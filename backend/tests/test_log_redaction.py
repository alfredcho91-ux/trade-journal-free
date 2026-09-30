import io
import logging
import sys

import pytest

from uvicorn.logging import AccessFormatter

from backend.utils.error_handler import APIError, create_error_response
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
    assert redact_text("credential_master_key=synthetic-master") == (
        "credential_master_key=[REDACTED]"
    )
    assert redact_text("[REDACTED]") == "[REDACTED]"
    register_sensitive_values("secret")
    assert "another" not in redact_text("secret_key:another")


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


def test_formatted_exception_logs_redact_known_values_in_all_handlers(tmp_path, capsys):
    """The actual formatter output must protect both explicit and implicit chains."""
    install_log_redaction()
    known = (
        "TJ_SYNTHETIC_SECRET_DO_NOT_LOG_API_KEY",
        "TJ_SYNTHETIC_SECRET_DO_NOT_LOG_API_SECRET",
        "TJ_SYNTHETIC_SECRET_DO_NOT_LOG_PASSPHRASE",
        "TJ_SYNTHETIC_SECRET_DO_NOT_LOG_MASTER_KEY",
        "TJ_SYNTHETIC_SECRET_DO_NOT_LOG_MIGRATED_VALUE",
        "TJ_SYNTHETIC_SECRET_DO_NOT_LOG_ENV_VALUE",
    )
    register_sensitive_values(*known)
    stream = io.StringIO()
    log_file = tmp_path / "synthetic-diagnostics.log"
    handlers = (
        logging.StreamHandler(stream),
        logging.StreamHandler(sys.stderr),
        logging.FileHandler(log_file, encoding="utf-8"),
    )
    logger = logging.getLogger("backend.tests.synthetic_redaction")
    previous_level, previous_propagate = logger.level, logger.propagate
    logger.setLevel(logging.ERROR)
    logger.propagate = False
    for handler in handlers:
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
        logger.addHandler(handler)
    try:
        logger.error("ordinary message: %s", known[0])
        try:
            raise ValueError("cause with useful details and " + known[1])
        except ValueError as cause:
            try:
                raise RuntimeError("primary failure " + known[2] + " " + known[3]) from cause
            except RuntimeError:
                logger.error("error path: %s", known[0], exc_info=True)
        try:
            raise OSError("context failure " + known[4])
        except OSError:
            try:
                raise LookupError("lookup failure " + known[5])
            except LookupError:
                logger.exception("exception path: %s", known[0])
    finally:
        for handler in handlers:
            logger.removeHandler(handler)
            handler.close()
        logger.setLevel(previous_level)
        logger.propagate = previous_propagate

    destinations = (stream.getvalue(), capsys.readouterr().err, log_file.read_text(encoding="utf-8"))
    for output in destinations:
        for secret in known:
            assert secret not in output
        assert output.count("[REDACTED]") >= len(known)
        assert "ValueError" in output and "RuntimeError" in output
        assert "OSError" in output and "LookupError" in output
        assert "test_formatted_exception_logs_redact_known_values_in_all_handlers" in output
        assert "useful details" in output


@pytest.mark.parametrize("error", [
    APIError("API detail TJ_SYNTHETIC_SECRET_DO_NOT_LOG_DIAGNOSTIC", status_code=400),
    ValueError("input detail TJ_SYNTHETIC_SECRET_DO_NOT_LOG_DIAGNOSTIC"),
    RuntimeError("unexpected detail TJ_SYNTHETIC_SECRET_DO_NOT_LOG_DIAGNOSTIC"),
])
def test_optional_api_diagnostic_traceback_redacts_known_value(error):
    secret = "TJ_SYNTHETIC_SECRET_DO_NOT_LOG_DIAGNOSTIC"
    register_sensitive_values(secret)
    try:
        raise error
    except type(error) as caught:
        response = create_error_response(caught, include_traceback=True)
    assert secret not in str(response)
    assert "[REDACTED]" in response["traceback"]
    assert type(error).__name__ in response["traceback"]
    assert "test_optional_api_diagnostic_traceback_redacts_known_value" in response["traceback"]


def test_formatted_traceback_preserves_structured_multiline_secret_as_one_marker():
    install_log_redaction()
    secret = "TJ_SYNTHETIC_SECRET_DO_NOT_LOG_part-1,=/_+\npart-2 with spaces"
    register_sensitive_values(secret)
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    logger = logging.getLogger("backend.tests.synthetic_multiline_redaction")
    previous_level, previous_propagate = logger.level, logger.propagate
    logger.setLevel(logging.ERROR)
    logger.propagate = False
    logger.addHandler(handler)
    try:
        try:
            raise RuntimeError("ordinary context " + secret)
        except RuntimeError:
            logger.exception("multiline failure")
    finally:
        logger.removeHandler(handler)
        handler.close()
        logger.setLevel(previous_level)
        logger.propagate = previous_propagate
    output = stream.getvalue()
    assert secret not in output
    assert "part-2 with spaces" not in output
    assert output.count("[REDACTED]") >= 1
    assert "ordinary context" in output and "RuntimeError" in output
