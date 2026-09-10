"""Security-floor and transport compatibility coverage for urllib3 upgrades."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import gzip
import ipaddress
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl
from threading import Thread

import requests
import urllib3
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from packaging.version import Version


class _TransportHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - stdlib request-handler hook
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/compressed")
            self.end_headers()
            return

        if self.path == "/compressed":
            payload = gzip.compress(b'{"source":"market-data","ok":true}')
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        self.send_error(404)

    def log_message(self, _format, *_args):
        """Keep the focused transport test quiet."""


def _write_localhost_certificate(tmp_path: Path) -> tuple[Path, Path]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(timezone.utc)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(minutes=5))
        .add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.DNSName("localhost"),
                    x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
                ]
            ),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    certificate_path = tmp_path / "localhost-cert.pem"
    key_path = tmp_path / "localhost-key.pem"
    certificate_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    return certificate_path, key_path


def test_secure_urllib3_requests_adapter_handles_tls_compression_and_redirects(tmp_path):
    """Market/exchange Requests traffic keeps TLS, gzip, and redirect behavior."""
    assert Version(urllib3.__version__) >= Version("2.7.0")

    certificate_path, key_path = _write_localhost_certificate(tmp_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _TransportHandler)
    tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls_context.load_cert_chain(certificate_path, key_path)
    server.socket = tls_context.wrap_socket(server.socket, server_side=True)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        base_url = f"https://127.0.0.1:{server.server_port}"
        session = requests.Session()
        response = session.get(f"{base_url}/redirect", verify=str(certificate_path), timeout=3)

        assert isinstance(session.get_adapter(base_url), requests.adapters.HTTPAdapter)
        assert [item.status_code for item in response.history] == [302]
        assert response.url == f"{base_url}/compressed"
        assert response.json() == {"source": "market-data", "ok": True}
    finally:
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()
