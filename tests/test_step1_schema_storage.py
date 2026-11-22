import os
import unittest
from pathlib import Path
from unittest import mock

from saas_app.db.storage import (
    PostgresStorageBackend,
    StorageError,
    SupabaseStorageBackend,
    create_storage_backend,
)

ROOT = Path(__file__).resolve().parent.parent


class TestStep1SchemaAndPluggableStorage(unittest.TestCase):
    def test_schema_contains_all_required_tables_and_constraints(self) -> None:
        schema_sql = (ROOT / "db" / "schema.sql").read_text(encoding="utf-8")
        required_tables = [
            "tenants",
            "sites",
            "operators",
            "operator_site_roles",
            "collectors",
            "site_enrollment_tokens",
            "assets",
            "payload_receipts",
            "metrics",
            "events",
            "incidents",
            "incident_events",
            "recommendations",
            "jobs",
            "health_history",
            "audit_logs",
            "site_notification_channels",
            "notification_threads",
        ]
        for tbl in required_tables:
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {tbl}", schema_sql)

        self.assertIn("UNIQUE (tenant_id, payload_id)", schema_sql)
        self.assertIn("enforce_site_region_residency()", schema_sql)
        self.assertIn("enforce_single_use_enrollment_token()", schema_sql)

    def test_rls_enabled_and_forced_on_all_tables(self) -> None:
        rls_sql = (ROOT / "db" / "rls_policies.sql").read_text(encoding="utf-8")
        for tbl in (
            "tenants",
            "sites",
            "collectors",
            "payload_receipts",
            "metrics",
            "events",
            "incidents",
            "recommendations",
            "jobs",
            "health_history",
            "audit_logs",
        ):
            self.assertIn(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY;", rls_sql)
            self.assertIn(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY;", rls_sql)
        self.assertIn("app.current_tenant_id", rls_sql)

    def test_storage_backend_defaults_to_local_postgres(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            backend = create_storage_backend()
            self.assertIsInstance(backend, PostgresStorageBackend)
            self.assertEqual(backend.backend_name, "postgres")

    def test_supabase_backend_requires_server_keys_and_enforces_tenant_id(self) -> None:
        with mock.patch.dict(os.environ, {"STORAGE_BACKEND": "supabase"}, clear=True):
            with self.assertRaises(StorageError):
                create_storage_backend()

        sb = SupabaseStorageBackend("https://example.supabase.co", "service-role-placeholder")
        self.assertEqual(sb.backend_name, "supabase")
        with self.assertRaises(StorageError):
            sb.query_metrics(tenant_id="", metric_name="cpu_total_percent")


if __name__ == "__main__":
    unittest.main()
