"""
Step 3: Tier 1 Ordered Pipeline
collect -> normalize -> redact -> aggregate -> analyze locally -> allow-list -> egress log -> buffer -> transmit
"""
from __future__ import annotations

import json
import socket
import uuid
from datetime import datetime, timezone
from typing import Any

from collector_app.buffer.sqlite_queue import CollectorSQLiteStore
from collector_app.policy.allow_list import strip_to_allow_list
from collector_app.redaction.redactor import LocalRedactor


def classify_health(metric_name: str, value: float) -> str:
    if metric_name in ("cpu_total_percent", "ram_usage_percent", "disk_usage_percent"):
        if value >= 90:
            return "Poor"
        if value >= 78:
            return "Fair"
        if value >= 60:
            return "Good"
        return "Excellent"
    if metric_name == "latency_avg_ms":
        if value >= 120:
            return "Poor"
        if value >= 60:
            return "Fair"
        if value >= 25:
            return "Good"
        return "Excellent"
    if metric_name == "packet_loss_percent":
        if value >= 5:
            return "Poor"
        if value >= 1.5:
            return "Fair"
        if value > 0:
            return "Good"
        return "Excellent"
    if metric_name == "service_availability_percent":
        return "Excellent" if value >= 99.9 else "Poor"
    if metric_name == "log_failed_login_count" and value >= 5:
        return "Fair"
    return "Good"


class CollectorPipeline:
    def __init__(
        self,
        store: CollectorSQLiteStore,
        redactor: LocalRedactor,
        collector_id: str,
        site_id: str,
        tenant_id: str,
        region: str,
        source_salt: str,
        collection_interval: int = 5,
    ) -> None:
        self.store = store
        self.redactor = redactor
        self.collector_id = collector_id
        self.site_id = site_id
        self.tenant_id = tenant_id
        self.region = region
        self.source_id = redactor.pseudonymize_source(socket.gethostname(), source_salt)
        self.collection_interval = collection_interval

    def process_samples(self, raw_samples: list[dict[str, Any]], source_override: str | None = None) -> dict[str, Any] | None:
        if not raw_samples:
            return None

        payload_id = str(uuid.uuid4())
        approved_samples: list[dict[str, Any]] = []

        for raw in raw_samples:
            # 1. Normalize
            metric_name = str(raw["metric_name"])
            metric_value = float(raw["metric_value"])
            unit = str(raw.get("unit", ""))
            ts_utc = str(raw.get("timestamp_utc") or datetime.now(timezone.utc).isoformat())
            source_tz = str(raw.get("source_timezone") or "UTC")
            connector = str(raw.get("connector") or "host")
            src_tag = source_override or ("simulated" if raw.get("source") == "simulated" else "live")

            # 2. Local analyze + health state
            health_state = str(raw.get("health_state") or classify_health(metric_name, metric_value))
            event_category = str(raw.get("event_category") or "metric_sample")
            severity = str(raw.get("severity") or ("high" if health_state == "Poor" else "medium" if health_state == "Fair" else "low"))

            raw_context = str(raw.get("alert_context") or f"{connector}:{metric_name}={metric_value}{unit}")
            # 3. Redact secrets locally
            clean_context, _matched = self.redactor.redact(raw_context)

            # Build candidate with extra internal fields that MUST be dropped by allow-list
            candidate = {
                "metric_name": metric_name,
                "metric_value": metric_value,
                "unit": unit,
                "timestamp_utc": ts_utc,
                "source_timezone": source_tz,
                "source_id": str(raw.get("source_id") or self.source_id),
                "health_state": health_state,
                "event_category": event_category,
                "severity": severity,
                "alert_context": clean_context,
                "collector_id": self.collector_id,
                "site_id": self.site_id,
                "tenant_id": self.tenant_id,
                "payload_id": payload_id,
                "source": src_tag,
                "connector": connector,
                "collection_interval": self.collection_interval,
                # Sensitive local-only attributes intentionally filtered out
                "raw_log_line": raw.get("raw_log_line"),
                "internal_hostname_raw": socket.gethostname(),
            }

            # 4. Apply strict allow-list
            approved, dropped = strip_to_allow_list(candidate)
            if raw.get("raw_log_line"):
                redacted_preview, _ = self.redactor.redact(str(raw["raw_log_line"]))
                self.store.record_raw_preview(
                    str(raw["raw_log_line"]),
                    redacted_preview,
                    json.dumps(dropped),
                    src_tag,
                )
            approved_samples.append(approved)

        if not approved_samples:
            return None

        batch_source = "simulated" if any(s["source"] == "simulated" for s in approved_samples) else "live"
        sent_at_utc = datetime.now(timezone.utc).isoformat()
        batch = {
            "payload_id": payload_id,
            "collector_id": self.collector_id,
            "region": self.region,
            "source": batch_source,
            "sent_at_utc": sent_at_utc,
            "samples": approved_samples,
        }
        batch_json = json.dumps(batch, separators=(",", ":"), sort_keys=True)
        # 5. Buffer in local SQLite queue prior to transmit
        self.store.enqueue(payload_id, sent_at_utc, batch_json)
        return batch
