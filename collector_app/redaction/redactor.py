"""
Step 3: Tier 1 Local Redaction Engine & Source Pseudonymizer.
Scrubs passwords, API keys, Bearer JWTs, emails, private IPs, and card-like numbers
inside Tier 1 before any data reaches egress_log or outbound_queue.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

DEFAULT_RULES_PATH = Path(__file__).resolve().parent.parent.parent / "collector" / "config" / "redaction_rules.json"

COMPLIANCE_PROFILES: dict[str, dict[str, Any]] = {
    "gdpr": {
        "retention_days": 7,
        "redact_emails": True,
        "redact_private_ips": True,
        "redact_cards": True,
    },
    "pci_dss": {
        "retention_days": 14,
        "redact_emails": True,
        "redact_private_ips": True,
        "redact_cards": True,
    },
    "hipaa": {
        "retention_days": 14,
        "redact_emails": True,
        "redact_private_ips": True,
        "redact_cards": True,
    },
    "rbi": {
        "retention_days": 30,
        "redact_emails": True,
        "redact_private_ips": True,
        "redact_cards": True,
    },
    "default": {
        "retention_days": 30,
        "redact_emails": True,
        "redact_private_ips": True,
        "redact_cards": True,
    },
}


class LocalRedactor:
    def __init__(self, rules_path: Path = DEFAULT_RULES_PATH, compliance_profile: str = "gdpr") -> None:
        self.profile_name = compliance_profile if compliance_profile in COMPLIANCE_PROFILES else "default"
        self.profile = COMPLIANCE_PROFILES[self.profile_name]
        self.patterns: list[tuple[str, re.Pattern[str], str]] = []
        if rules_path.exists():
            cfg = json.loads(rules_path.read_text(encoding="utf-8"))
            for item in cfg.get("patterns", []):
                repl = item["replacement"].replace("$1", r"\1")
                self.patterns.append((item["name"], re.compile(item["regex"]), repl))
        # Extra high-entropy token patterns (e.g., sk-, AIza, aur_)
        self.patterns.append(
            ("provider_api_key", re.compile(r"\b(?:sk-|AIza|ghp_|aur_)[A-Za-z0-9_\-]{12,}\b"), "[REDACTED_API_KEY]")
        )

    def redact(self, text: str) -> tuple[str, list[str]]:
        scrubbed = text
        matched_rules: list[str] = []
        for name, pat, repl in self.patterns:
            if name == "email_address" and not self.profile.get("redact_emails", True):
                continue
            if name == "ipv4_private" and not self.profile.get("redact_private_ips", True):
                continue
            if name == "card_number" and not self.profile.get("redact_cards", True):
                continue
            new_val, count = pat.subn(repl, scrubbed)
            if count > 0:
                matched_rules.append(name)
                scrubbed = new_val
        return scrubbed, matched_rules

    @staticmethod
    def pseudonymize_source(raw_identifier: str, salt: str) -> str:
        digest = hashlib.sha256(f"{salt}:{raw_identifier}".encode("utf-8")).hexdigest()
        return f"src_{digest[:16]}"
