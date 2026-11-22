"""
Step 2: Tier 2 Strict Metadata-Only Payload Schema & Allow-List Validator.
Uses Pydantic v2 (extra="forbid") when pydantic is installed, with an identical
strict stdlib fallback validator so verification runs cleanly without external packages.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

ALLOW_LIST_FIELDS: frozenset[str] = frozenset(
    {
        "metric_name",
        "metric_value",
        "unit",
        "timestamp_utc",
        "source_timezone",
        "source_id",
        "health_state",
        "event_category",
        "severity",
        "alert_context",
        "collector_id",
        "site_id",
        "tenant_id",
        "payload_id",
        "source",
        "connector",
        "collection_interval",
    }
)

VALID_HEALTH_STATES = {"Excellent", "Good", "Fair", "Poor"}
VALID_SEVERITIES = {"low", "medium", "high", "critical"}
VALID_SOURCES = {"live", "simulated"}
VALID_REGIONS = {"us-east-1", "us-west-2", "eu-central-1", "eu-west-1", "ap-south-1"}

# Defense-in-depth leak detector at Tier 2 boundary (rejects any unredacted secret)
SECRET_LEAK_PATTERNS = [
    re.compile(r"(?i)\b(password|passwd|pwd|secret|api_key|apikey|token)\s*[=:]\s*(?!\[REDACTED_SECRET\])\S+"),
    re.compile(r"(?i)Bearer\s+(?!\[REDACTED_TOKEN\])[A-Za-z0-9\-._~+/=]{8,}"),
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    re.compile(r"\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b"),
    re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
]


class PayloadValidationError(ValueError):
    """Raised when an incoming ingest payload violates strict allow-list or type rules."""


def _validate_iso_utc(ts: str) -> str:
    if not isinstance(ts, str) or not ts.strip():
        raise PayloadValidationError("timestamp_utc must be a non-empty ISO 8601 string")
    normalized = ts.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise PayloadValidationError(f"Invalid ISO 8601 timestamp_utc: {ts}") from exc
    if dt.tzinfo is None:
        raise PayloadValidationError("timestamp_utc must include timezone offset or 'Z'")
    return ts


def _validate_uuid(val: str, field_name: str) -> str:
    if not isinstance(val, str):
        raise PayloadValidationError(f"{field_name} must be a UUID string")
    try:
        uuid.UUID(val)
    except ValueError as exc:
        raise PayloadValidationError(f"{field_name} is not a valid UUID: {val}") from exc
    return val


def _assert_no_secret_leak(text: str, field_name: str) -> str:
    for pat in SECRET_LEAK_PATTERNS:
        if pat.search(text):
            raise PayloadValidationError(
                f"Rejected unredacted sensitive pattern in '{field_name}' at Tier 2 boundary"
            )
    return text


try:  # pragma: no cover - used when pydantic v2 is installed
    from pydantic import BaseModel, ConfigDict, Field, field_validator

    class MetadataSampleSchema(BaseModel):
        model_config = ConfigDict(extra="forbid", strict=False)

        metric_name: str = Field(min_length=1, max_length=120)
        metric_value: float
        unit: str = Field(min_length=0, max_length=32)
        timestamp_utc: str
        source_timezone: str = Field(min_length=1, max_length=64)
        source_id: str = Field(min_length=3, max_length=128)
        health_state: Literal["Excellent", "Good", "Fair", "Poor"]
        event_category: str = Field(min_length=1, max_length=64)
        severity: Literal["low", "medium", "high", "critical"]
        alert_context: str = Field(max_length=512)
        collector_id: str = Field(min_length=1, max_length=128)
        site_id: str = Field(min_length=1, max_length=128)
        tenant_id: str = Field(min_length=1, max_length=128)
        payload_id: str
        source: Literal["live", "simulated"]
        connector: str = Field(min_length=1, max_length=64)
        collection_interval: int = Field(ge=1, le=3600)

        @field_validator("timestamp_utc")
        @classmethod
        def _chk_ts(cls, v: str) -> str:
            return _validate_iso_utc(v)

        @field_validator("payload_id")
        @classmethod
        def _chk_pid(cls, v: str) -> str:
            return _validate_uuid(v, "payload_id")

        @field_validator("alert_context")
        @classmethod
        def _chk_ctx(cls, v: str) -> str:
            return _assert_no_secret_leak(v, "alert_context")

    class IngestBatchSchema(BaseModel):
        model_config = ConfigDict(extra="forbid")

        payload_id: str
        collector_id: str = Field(min_length=1, max_length=128)
        region: Literal["us-east-1", "us-west-2", "eu-central-1", "eu-west-1", "ap-south-1"]
        source: Literal["live", "simulated"]
        sent_at_utc: str
        samples: list[MetadataSampleSchema] = Field(min_length=1, max_length=500)

        @field_validator("payload_id")
        @classmethod
        def _chk_batch_pid(cls, v: str) -> str:
            return _validate_uuid(v, "payload_id")

        @field_validator("sent_at_utc")
        @classmethod
        def _chk_sent_ts(cls, v: str) -> str:
            return _validate_iso_utc(v)

except ImportError:

    @dataclass(frozen=True)
    class MetadataSampleSchema:  # type: ignore[no-redef]
        metric_name: str
        metric_value: float
        unit: str
        timestamp_utc: str
        source_timezone: str
        source_id: str
        health_state: str
        event_category: str
        severity: str
        alert_context: str
        collector_id: str
        site_id: str
        tenant_id: str
        payload_id: str
        source: str
        connector: str
        collection_interval: int = 5

        @classmethod
        def model_validate(cls, data: dict[str, Any]) -> "MetadataSampleSchema":
            if not isinstance(data, dict):
                raise PayloadValidationError("Sample must be a JSON object")
            extra = set(data.keys()) - ALLOW_LIST_FIELDS
            if extra:
                raise PayloadValidationError(f"Extra fields forbidden: {sorted(extra)}")
            missing = ALLOW_LIST_FIELDS - set(data.keys())
            if missing:
                raise PayloadValidationError(f"Missing required allow-listed fields: {sorted(missing)}")

            if data["health_state"] not in VALID_HEALTH_STATES:
                raise PayloadValidationError(f"Invalid health_state: {data['health_state']}")
            if data["severity"] not in VALID_SEVERITIES:
                raise PayloadValidationError(f"Invalid severity: {data['severity']}")
            if data["source"] not in VALID_SOURCES:
                raise PayloadValidationError(f"Invalid source tag: {data['source']}")

            val = data["metric_value"]
            if isinstance(val, bool) or not isinstance(val, (int, float)):
                raise PayloadValidationError("metric_value must be numeric")

            interval = data["collection_interval"]
            if isinstance(interval, bool) or not isinstance(interval, int) or not (1 <= interval <= 3600):
                raise PayloadValidationError("collection_interval must be integer in [1, 3600]")

            _validate_iso_utc(data["timestamp_utc"])
            _validate_uuid(data["payload_id"], "payload_id")
            _assert_no_secret_leak(str(data["alert_context"]), "alert_context")
            _assert_no_secret_leak(str(data["metric_name"]), "metric_name")

            return cls(**{k: data[k] for k in ALLOW_LIST_FIELDS})

    @dataclass(frozen=True)
    class IngestBatchSchema:  # type: ignore[no-redef]
        payload_id: str
        collector_id: str
        region: str
        source: str
        sent_at_utc: str
        samples: list[MetadataSampleSchema] = field(default_factory=list)

        @classmethod
        def model_validate(cls, data: dict[str, Any]) -> "IngestBatchSchema":
            if not isinstance(data, dict):
                raise PayloadValidationError("Ingest batch must be a JSON object")
            allowed_top = {"payload_id", "collector_id", "region", "source", "sent_at_utc", "samples"}
            extra = set(data.keys()) - allowed_top
            if extra:
                raise PayloadValidationError(f"Extra batch fields forbidden: {sorted(extra)}")
            missing = allowed_top - set(data.keys())
            if missing:
                raise PayloadValidationError(f"Missing batch fields: {sorted(missing)}")

            _validate_uuid(data["payload_id"], "payload_id")
            _validate_iso_utc(data["sent_at_utc"])
            if data["region"] not in VALID_REGIONS:
                raise PayloadValidationError(f"Invalid region: {data['region']}")
            if data["source"] not in VALID_SOURCES:
                raise PayloadValidationError(f"Invalid source: {data['source']}")
            if not isinstance(data["samples"], list) or not (1 <= len(data["samples"]) <= 500):
                raise PayloadValidationError("samples must contain 1..500 records")

            parsed_samples = [MetadataSampleSchema.model_validate(s) for s in data["samples"]]
            return cls(
                payload_id=data["payload_id"],
                collector_id=data["collector_id"],
                region=data["region"],
                source=data["source"],
                sent_at_utc=data["sent_at_utc"],
                samples=parsed_samples,
            )


def validate_ingest_batch(raw_payload: dict[str, Any]) -> IngestBatchSchema:
    """Validate an incoming Tier 2 ingest batch against strict allow-list + secret-leak checks."""
    try:
        return IngestBatchSchema.model_validate(raw_payload)
    except Exception as exc:
        if isinstance(exc, PayloadValidationError):
            raise
        raise PayloadValidationError(str(exc)) from exc
