"""
Step 2: Tier 1 Data Policy (Allow-List Enforcement).
Drops every field not explicitly listed in ALLOW_LIST_FIELDS before writing to egress_log or transmitting.
"""
from __future__ import annotations

from typing import Any

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


def strip_to_allow_list(record: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """
    Filter a Tier 1 candidate record down to strictly allow-listed fields.
    Returns (approved_record, dropped_field_names).
    """
    approved: dict[str, Any] = {}
    dropped: list[str] = []
    for key, value in record.items():
        if key in ALLOW_LIST_FIELDS:
            approved[key] = value
        else:
            dropped.append(key)
    return approved, sorted(dropped)
