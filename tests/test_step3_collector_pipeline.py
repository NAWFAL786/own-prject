import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from collector_app.buffer.sqlite_queue import CollectorSQLiteStore
from collector_app.pipeline.runner import CollectorPipeline
from collector_app.redaction.redactor import LocalRedactor
from collector_app.sources.adapters import AuthSyslogAdapter, OrganizerReplayAdapter


class TestStep3CollectorPipeline(unittest.TestCase):
    def test_redaction_and_pseudonymization(self) -> None:
        redactor = LocalRedactor(compliance_profile="gdpr")
        raw = (
            "auth_debug user=elena@aurelis-ops.io password=MySecretPassword123 "
            "src_ip=10.24.8.14 Authorization=Bearer eyJhbGciOiJIUzI1NiJ9.secret "
            "api_key=sk-1234567890abcdef"
        )
        scrubbed, rules = redactor.redact(raw)
        self.assertNotIn("MySecretPassword123", scrubbed)
        self.assertNotIn("eyJhbGciOiJIUzI1NiJ9.secret", scrubbed)
        self.assertNotIn("elena@aurelis-ops.io", scrubbed)
        self.assertNotIn("10.24.8.14", scrubbed)
        self.assertNotIn("sk-1234567890abcdef", scrubbed)
        self.assertGreaterEqual(len(rules), 3)

        p1 = redactor.pseudonymize_source("prod-web-01.internal", "salt-A")
        p2 = redactor.pseudonymize_source("prod-web-01.internal", "salt-B")
        self.assertTrue(p1.startswith("src_"))
        self.assertNotEqual(p1, p2)

    def test_auth_syslog_burst_emits_summary_only(self) -> None:
        adapter = AuthSyslogAdapter(Path("/nonexistent"), burst_threshold=5)
        lines = [
            f"2026-11-22T10:00:0{i}Z WARN failed_login user=admin password=secret_{i} ip=192.168.1.{i}"
            for i in range(1, 9)
        ]
        samples = adapter.analyze_lines(lines)
        self.assertEqual(len(samples), 2)
        burst = samples[0]
        self.assertEqual(burst["metric_name"], "log_failed_login_count")
        self.assertEqual(burst["metric_value"], 8.0)
        self.assertEqual(burst["event_category"], "auth_failure_burst")
        self.assertNotIn("secret_1", burst["alert_context"])
        self.assertNotIn("192.168.1", burst["alert_context"])

    def test_organizer_replay_adapter_tags_simulated(self) -> None:
        stream_path = ROOT / "collector" / "data" / "organizer_stream.jsonl"
        adapter = OrganizerReplayAdapter(stream_path)
        records = adapter.load_records()
        self.assertGreaterEqual(len(records), 3)
        for rec in records:
            self.assertEqual(rec["source"], "simulated")
            self.assertIn("metric_name", rec)
            self.assertIn("timestamp_utc", rec)

    def test_pipeline_allow_list_outage_buffer_and_retention(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "tier1.db"
            store = CollectorSQLiteStore(db_path, retention_days=7)
            redactor = LocalRedactor(compliance_profile="gdpr")
            pipeline = CollectorPipeline(
                store=store,
                redactor=redactor,
                collector_id="col-test-01",
                site_id="site-blr-hq",
                tenant_id="tenant-aurelis",
                region="ap-south-1",
                source_salt="test-salt",
            )

            batch = pipeline.process_samples(
                [
                    {
                        "metric_name": "cpu_total_percent",
                        "metric_value": 44.2,
                        "unit": "%",
                        "alert_context": "token=ghp_superSecretToken999999 on host",
                        "raw_log_line": "raw user=bob@corp.com password=badpass",
                    }
                ]
            )
            self.assertIsNotNone(batch)
            assert batch is not None
            sample = batch["samples"][0]
            self.assertNotIn("raw_log_line", sample)
            self.assertNotIn("internal_hostname_raw", sample)
            self.assertNotIn("ghp_superSecretToken999999", sample["alert_context"])
            self.assertEqual(store.queue_depth(), 1)

            # Simulate outage retry backoff + eventual delivery
            pending = store.pending_batches()
            self.assertEqual(len(pending), 1)
            pid, attempts, pjson = pending[0]
            delay = store.mark_retry(pid, attempts, "http://127.0.0.1:3000/v1/ingest", pjson, 503)
            self.assertGreaterEqual(delay, 1.0)
            self.assertEqual(store.queue_depth(), 1)

            store.mark_delivered(pid, "http://127.0.0.1:3000/v1/ingest", pjson, "202_ACCEPTED")
            self.assertEqual(store.queue_depth(), 0)

            # Verify expired raw_preview pruning
            old_ts = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
            store.conn.execute(
                "INSERT INTO raw_preview (captured_at_utc, raw_line, redacted_line, dropped_fields, source) VALUES (?, ?, ?, ?, ?)",
                (old_ts, "old_raw", "old_redacted", "[]", "live"),
            )
            store.conn.commit()
            pruned = store.prune_expired_raw()
            self.assertEqual(pruned, 1)
            store.close()


if __name__ == "__main__":
    unittest.main()
