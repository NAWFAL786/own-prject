import unittest
import uuid
from datetime import datetime, timezone

from collector_app.policy.allow_list import ALLOW_LIST_FIELDS, strip_to_allow_list
from saas_app.ingest.schemas import PayloadValidationError, validate_ingest_batch


def _valid_sample(payload_id: str) -> dict:
    return {
        "metric_name": "cpu_total_percent",
        "metric_value": 41.2,
        "unit": "%",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "source_timezone": "Asia/Kolkata",
        "source_id": "src_a1b2c3d4e5f6",
        "health_state": "Excellent",
        "event_category": "metric_sample",
        "severity": "low",
        "alert_context": "host:cpu_total_percent=41.2%",
        "collector_id": "col-local-primary",
        "site_id": "site-blr-hq",
        "tenant_id": "tenant-meridian",
        "payload_id": payload_id,
        "source": "live",
        "connector": "host",
        "collection_interval": 5,
    }


def _valid_batch(sample_override: dict | None = None) -> dict:
    pid = str(uuid.uuid4())
    return {
        "payload_id": pid,
        "collector_id": "col-local-primary",
        "region": "ap-south-1",
        "source": "live",
        "sent_at_utc": datetime.now(timezone.utc).isoformat(),
        "samples": [sample_override if sample_override is not None else _valid_sample(pid)],
    }


class TestStep2PayloadSchemaAndAllowList(unittest.TestCase):
    def test_valid_allow_listed_batch_passes(self) -> None:
        batch = validate_ingest_batch(_valid_batch())
        self.assertEqual(batch.region, "ap-south-1")
        self.assertEqual(len(batch.samples), 1)
        self.assertEqual(batch.samples[0].source, "live")

    def test_extra_field_is_rejected_at_tier2(self) -> None:
        pid = str(uuid.uuid4())
        bad_sample = _valid_sample(pid)
        bad_sample["raw_log_line"] = "secret debug line"
        with self.assertRaises(PayloadValidationError):
            validate_ingest_batch(
                {
                    "payload_id": pid,
                    "collector_id": "col-local-primary",
                    "region": "ap-south-1",
                    "source": "live",
                    "sent_at_utc": datetime.now(timezone.utc).isoformat(),
                    "samples": [bad_sample],
                }
            )

    def test_unredacted_secret_in_alert_context_is_rejected(self) -> None:
        pid = str(uuid.uuid4())
        bad_sample = _valid_sample(pid)
        bad_sample["alert_context"] = "auth failure password=abc123"
        with self.assertRaises(PayloadValidationError):
            validate_ingest_batch(
                {
                    "payload_id": pid,
                    "collector_id": "col-local-primary",
                    "region": "ap-south-1",
                    "source": "live",
                    "sent_at_utc": datetime.now(timezone.utc).isoformat(),
                    "samples": [bad_sample],
                }
            )

    def test_invalid_source_or_health_state_is_rejected(self) -> None:
        pid = str(uuid.uuid4())
        bad_sample = _valid_sample(pid)
        bad_sample["source"] = "mock_unlabeled"
        with self.assertRaises(PayloadValidationError):
            validate_ingest_batch(
                {
                    "payload_id": pid,
                    "collector_id": "col-local-primary",
                    "region": "ap-south-1",
                    "source": "live",
                    "sent_at_utc": datetime.now(timezone.utc).isoformat(),
                    "samples": [bad_sample],
                }
            )

    def test_tier1_strip_to_allow_list_drops_unapproved_fields(self) -> None:
        pid = str(uuid.uuid4())
        candidate = _valid_sample(pid)
        candidate["process_cmdline"] = "/usr/bin/app --secret=xyz"
        candidate["internal_ip"] = "10.0.2.15"
        approved, dropped = strip_to_allow_list(candidate)
        self.assertEqual(set(approved.keys()), set(ALLOW_LIST_FIELDS))
        self.assertEqual(dropped, ["internal_ip", "process_cmdline"])


if __name__ == "__main__":
    unittest.main()
