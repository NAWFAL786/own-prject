"""
Step 4: Tier 2 Collector Authentication & HMAC-SHA256 Replay Verification.
Derives tenant_id and site_id strictly from authenticated collector lookup—never from request body.
"""
from __future__ import annotations

import hashlib
import hmac
import time


class CollectorAuthError(PermissionError):
    """Raised on invalid collector key, stale timestamp, or HMAC signature mismatch."""


def sign_request(hmac_secret: str, timestamp_sec: int, body_bytes: bytes) -> str:
    msg = f"{timestamp_sec}.".encode("utf-8") + body_bytes
    return hmac.new(hmac_secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def verify_collector_hmac(
    provided_token: str,
    expected_token: str,
    hmac_secret: str,
    timestamp_header: str,
    signature_header: str,
    body_bytes: bytes,
    now_epoch: float | None = None,
    max_skew_seconds: int = 300,
) -> None:
    if not provided_token or not hmac.compare_digest(provided_token, expected_token):
        raise CollectorAuthError("Invalid collector API key")

    try:
        ts_sec = int(timestamp_header)
    except (TypeError, ValueError) as exc:
        raise CollectorAuthError("Invalid X-Aurelis-Timestamp header") from exc

    current = time.time() if now_epoch is None else now_epoch
    if abs(current - ts_sec) > max_skew_seconds:
        raise CollectorAuthError("Rejected stale timestamp outside replay window")

    expected_sig = sign_request(hmac_secret, ts_sec, body_bytes)
    if not signature_header or not hmac.compare_digest(signature_header, expected_sig):
        raise CollectorAuthError("HMAC-SHA256 signature verification failed")
