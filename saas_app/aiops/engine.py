"""
Step 7: Metadata-Only AIOps Engine
- Rolling EWMA / mean+std baseline and z-score anomaly detection
- 5-minute alert correlation into single incidents with merged alert counts
- Fix-or-Notify decision engine (AUTO_FIX / ASK_APPROVAL / NOTIFY_ONLY)
- Explainable recommendations schema
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AnomalyResult:
    is_anomaly: bool
    z_score: float
    rolling_mean: float
    rolling_std: float
    reason: str


def detect_ewma_zscore_anomaly(
    history_values: list[float],
    current_value: float,
    z_threshold: float = 2.2,
) -> AnomalyResult:
    if len(history_values) < 4:
        return AnomalyResult(False, 0.0, current_value, 0.0, "Insufficient baseline window (<4 points)")

    mean = sum(history_values) / len(history_values)
    variance = sum((v - mean) ** 2 for v in history_values) / max(1, len(history_values) - 1)
    std = math.sqrt(variance)
    if std < 0.05:
        std = 0.05
    z = (current_value - mean) / std
    is_anom = abs(z) >= z_threshold
    reason = (
        f"Value {current_value:.2f} deviated {z:+.2f} sigma from rolling mean {mean:.2f}"
        if is_anom
        else "Within rolling baseline band"
    )
    return AnomalyResult(is_anom, round(z, 3), round(mean, 3), round(std, 3), reason)


def decide_fix_or_notify(
    cause_signal: str,
    confidence: float,
    local_policy: dict[str, Any],
    action_catalog_entry: dict[str, Any] | None,
) -> dict[str, Any]:
    if local_policy.get("kill_switch", False):
        return {
            "decision_mode": "NOTIFY_ONLY",
            "reason": "Local collector kill_switch is ON; human runbook notification only.",
        }

    if not action_catalog_entry:
        return {
            "decision_mode": "NOTIFY_ONLY",
            "reason": f"No safe automated action mapped for '{cause_signal}'; human investigation required.",
        }

    action_id = action_catalog_entry["action_id"]
    risk_level = action_catalog_entry["risk_level"]
    allowed_actions = set(local_policy.get("allowed_actions", []))
    policy_mode = local_policy.get("mode", "approval_required")

    if action_id not in allowed_actions:
        return {
            "decision_mode": "NOTIFY_ONLY",
            "reason": f"Action '{action_id}' is not enabled in the site's local allow-list.",
        }

    if risk_level == "low" and policy_mode == "auto_approved" and confidence >= 0.85:
        return {
            "decision_mode": "AUTO_FIX",
            "reason": f"Low-risk action '{action_id}' passed local policy and confidence threshold ({confidence:.0%}).",
        }

    return {
        "decision_mode": "ASK_APPROVAL",
        "reason": f"Action '{action_id}' (risk={risk_level}) requires operator approval before Tier 1 execution.",
    }
