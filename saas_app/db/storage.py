"""
Pluggable Tier 2 SaaS Storage Layer.
Controlled via STORAGE_BACKEND=postgres|supabase (defaults to 'postgres' for local docker-compose).
Tenant isolation is strictly enforced at BOTH the API/repository layer (mandatory tenant_id filters)
and the database RLS layer. Supabase service-role credentials are never exposed to client code.
"""
from __future__ import annotations

import os
from abc import ABC, abstractmethod
from typing import Any


class StorageError(RuntimeError):
    """Raised when storage configuration or tenant isolation invariants fail."""


class SaaSStorageBackend(ABC):
    backend_name: str

    @abstractmethod
    def query_metrics(
        self,
        tenant_id: str,
        metric_name: str,
        site_id: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        """Query metrics strictly scoped to tenant_id, ordered by timestamp_utc."""

    @abstractmethod
    def insert_receipt_and_metrics(
        self,
        tenant_id: str,
        site_id: str,
        collector_id: str,
        payload_id: str,
        region: str,
        source: str,
        payload_sha256: str,
        sent_at_utc: str,
        samples: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Idempotently persist payload_receipt + metadata metrics inside tenant scope."""

    @abstractmethod
    def list_sites(self, tenant_id: str) -> list[dict[str, Any]]:
        """List sites strictly scoped to tenant_id."""


class PostgresStorageBackend(SaaSStorageBackend):
    backend_name = "postgres"

    def __init__(self, database_url: str) -> None:
        if not database_url:
            raise StorageError("DATABASE_URL is required when STORAGE_BACKEND=postgres")
        self.database_url = database_url

    def _connect(self):
        try:
            import psycopg  # type: ignore
        except ImportError as exc:  # pragma: no cover
            raise StorageError("psycopg package is required for live PostgreSQL connections") from exc
        return psycopg.connect(self.database_url)

    def _set_tenant_context(self, cur: Any, tenant_id: str) -> None:
        if not tenant_id:
            raise StorageError("tenant_id is mandatory for all Tier 2 queries")
        # Parameterized session context for PostgreSQL RLS policies
        cur.execute("SELECT set_config('app.current_tenant_id', %s, true)", (tenant_id,))

    def query_metrics(
        self,
        tenant_id: str,
        metric_name: str,
        site_id: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                self._set_tenant_context(cur, tenant_id)
                if site_id:
                    cur.execute(
                        """
                        SELECT source_id, metric_name, metric_value, unit, health_state, source, source_timezone, timestamp_utc
                        FROM metrics
                        WHERE tenant_id = %s AND site_id = %s AND metric_name = %s
                        ORDER BY timestamp_utc ASC
                        LIMIT %s
                        """,
                        (tenant_id, site_id, metric_name, limit),
                    )
                else:
                    cur.execute(
                        """
                        SELECT source_id, metric_name, metric_value, unit, health_state, source, source_timezone, timestamp_utc
                        FROM metrics
                        WHERE tenant_id = %s AND metric_name = %s
                        ORDER BY timestamp_utc ASC
                        LIMIT %s
                        """,
                        (tenant_id, metric_name, limit),
                    )
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]

    def insert_receipt_and_metrics(
        self,
        tenant_id: str,
        site_id: str,
        collector_id: str,
        payload_id: str,
        region: str,
        source: str,
        payload_sha256: str,
        sent_at_utc: str,
        samples: list[dict[str, Any]],
    ) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                self._set_tenant_context(cur, tenant_id)
                cur.execute(
                    """
                    INSERT INTO payload_receipts (tenant_id, site_id, collector_id, payload_id, region, source, payload_sha256, record_count, sent_at_utc)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (tenant_id, payload_id) DO NOTHING
                    RETURNING id
                    """,
                    (tenant_id, site_id, collector_id, payload_id, region, source, payload_sha256, len(samples), sent_at_utc),
                )
                inserted = cur.fetchone()
                if inserted is None:
                    conn.commit()
                    return {"status": "duplicate_ignored", "payload_id": payload_id}

                for s in samples:
                    cur.execute(
                        """
                        INSERT INTO metrics (tenant_id, site_id, collector_id, payload_id, source_id, metric_name, metric_value, unit, health_state, source, connector, collection_interval, source_timezone, timestamp_utc)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            tenant_id,
                            site_id,
                            collector_id,
                            payload_id,
                            s["source_id"],
                            s["metric_name"],
                            s["metric_value"],
                            s["unit"],
                            s["health_state"],
                            s["source"],
                            s["connector"],
                            s.get("collection_interval", 5),
                            s["source_timezone"],
                            s["timestamp_utc"],
                        ),
                    )
                conn.commit()
                return {"status": "accepted", "payload_id": payload_id}

    def list_sites(self, tenant_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                self._set_tenant_context(cur, tenant_id)
                cur.execute(
                    "SELECT id, tenant_id, name, region, timezone, sector_tag, status, last_seen_utc FROM sites WHERE tenant_id = %s ORDER BY created_at_utc ASC",
                    (tenant_id,),
                )
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]


class SupabaseStorageBackend(SaaSStorageBackend):
    backend_name = "supabase"

    def __init__(self, supabase_url: str, service_role_key: str) -> None:
        if not supabase_url or not service_role_key:
            raise StorageError(
                "SUPABASE_URL and server-side SUPABASE_SERVICE_ROLE_KEY are required when STORAGE_BACKEND=supabase"
            )
        self.supabase_url = supabase_url
        self._service_role_key = service_role_key
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from supabase import create_client  # type: ignore
            except ImportError as exc:  # pragma: no cover
                raise StorageError("supabase package is required when STORAGE_BACKEND=supabase") from exc
            self._client = create_client(self.supabase_url, self._service_role_key)
        return self._client

    def query_metrics(
        self,
        tenant_id: str,
        metric_name: str,
        site_id: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        if not tenant_id:
            raise StorageError("tenant_id is mandatory for all Tier 2 queries")
        q = (
            self._get_client()
            .table("metrics")
            .select("source_id,metric_name,metric_value,unit,health_state,source,source_timezone,timestamp_utc")
            .eq("tenant_id", tenant_id)
            .eq("metric_name", metric_name)
            .order("timestamp_utc", desc=False)
            .limit(limit)
        )
        if site_id:
            q = q.eq("site_id", site_id)
        return list(q.execute().data or [])

    def insert_receipt_and_metrics(
        self,
        tenant_id: str,
        site_id: str,
        collector_id: str,
        payload_id: str,
        region: str,
        source: str,
        payload_sha256: str,
        sent_at_utc: str,
        samples: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not tenant_id:
            raise StorageError("tenant_id is mandatory")
        client = self._get_client()
        existing = (
            client.table("payload_receipts")
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("payload_id", payload_id)
            .execute()
            .data
        )
        if existing:
            return {"status": "duplicate_ignored", "payload_id": payload_id}

        client.table("payload_receipts").insert(
            {
                "tenant_id": tenant_id,
                "site_id": site_id,
                "collector_id": collector_id,
                "payload_id": payload_id,
                "region": region,
                "source": source,
                "payload_sha256": payload_sha256,
                "record_count": len(samples),
                "sent_at_utc": sent_at_utc,
            }
        ).execute()

        rows = [
            {
                "tenant_id": tenant_id,
                "site_id": site_id,
                "collector_id": collector_id,
                "payload_id": payload_id,
                "source_id": s["source_id"],
                "metric_name": s["metric_name"],
                "metric_value": s["metric_value"],
                "unit": s["unit"],
                "health_state": s["health_state"],
                "source": s["source"],
                "connector": s["connector"],
                "collection_interval": s.get("collection_interval", 5),
                "source_timezone": s["source_timezone"],
                "timestamp_utc": s["timestamp_utc"],
            }
            for s in samples
        ]
        if rows:
            client.table("metrics").insert(rows).execute()
        return {"status": "accepted", "payload_id": payload_id}

    def list_sites(self, tenant_id: str) -> list[dict[str, Any]]:
        if not tenant_id:
            raise StorageError("tenant_id is mandatory")
        return list(
            self._get_client()
            .table("sites")
            .select("id,tenant_id,name,region,timezone,sector_tag,status,last_seen_utc")
            .eq("tenant_id", tenant_id)
            .order("created_at_utc", desc=False)
            .execute()
            .data
            or []
        )


def create_storage_backend() -> SaaSStorageBackend:
    """
    Factory selecting STORAGE_BACKEND=postgres|supabase.
    Defaults to local Postgres (zero external accounts required).
    """
    backend = os.environ.get("STORAGE_BACKEND", "postgres").strip().lower()
    if backend == "postgres":
        default_local = os.environ.get("DATABASE_URL", "postgresql://postgres@localhost:5432/aurelis")
        return PostgresStorageBackend(default_local)
    if backend == "supabase":
        return SupabaseStorageBackend(
            os.environ.get("SUPABASE_URL", ""),
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
        )
    raise StorageError(f"Unsupported STORAGE_BACKEND: {backend}. Expected 'postgres' or 'supabase'.")
