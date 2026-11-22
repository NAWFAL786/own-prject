"""
Step 3 & 5: Persistent Tier 1 SQLite Buffer & Egress Proof Log.
Stores exact outgoing JSON before send, queues failed sends with exponential backoff + jitter,
and guarantees zero loss and zero duplicates via idempotent payload_id.
"""
from __future__ import annotations

import hashlib
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


class CollectorSQLiteStore:
    def __init__(self, db_path: Path, retention_days: int = 7) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.retention_days = max(1, retention_days)
        self.conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        self.conn.execute("PRAGMA journal_mode=WAL;")
        self._init_tables()

    def _init_tables(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS egress_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload_id TEXT NOT NULL,
                timestamp_utc TEXT NOT NULL,
                byte_size INTEGER NOT NULL,
                destination TEXT NOT NULL,
                result TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS outbound_queue (
                payload_id TEXT PRIMARY KEY,
                created_at_utc TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                next_retry_mono REAL NOT NULL DEFAULT 0,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS raw_preview (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at_utc TEXT NOT NULL,
                raw_line TEXT NOT NULL,
                redacted_line TEXT NOT NULL,
                dropped_fields TEXT NOT NULL,
                source TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS local_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp_utc TEXT NOT NULL,
                action TEXT NOT NULL,
                detail TEXT NOT NULL
            );
            """
        )
        self.conn.commit()

    def record_raw_preview(self, raw_line: str, redacted_line: str, dropped_fields_json: str, source: str) -> None:
        self.conn.execute(
            "INSERT INTO raw_preview (captured_at_utc, raw_line, redacted_line, dropped_fields, source) VALUES (?, ?, ?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(), raw_line, redacted_line, dropped_fields_json, source),
        )
        self.conn.commit()

    def enqueue(self, payload_id: str, created_at_utc: str, payload_json: str) -> None:
        self.conn.execute(
            "INSERT OR IGNORE INTO outbound_queue (payload_id, created_at_utc, attempts, next_retry_mono, payload_json) VALUES (?, ?, 0, 0, ?)",
            (payload_id, created_at_utc, payload_json),
        )
        self.conn.commit()

    def pending_batches(self, limit: int = 20) -> list[tuple[str, int, str]]:
        now_mono = time.monotonic()
        return self.conn.execute(
            "SELECT payload_id, attempts, payload_json FROM outbound_queue WHERE next_retry_mono <= ? ORDER BY created_at_utc ASC LIMIT ?",
            (now_mono, limit),
        ).fetchall()

    def mark_delivered(self, payload_id: str, destination: str, payload_json: str, result: str = "202_ACCEPTED") -> None:
        now_utc = datetime.now(timezone.utc).isoformat()
        self.conn.execute("DELETE FROM outbound_queue WHERE payload_id = ?", (payload_id,))
        self.conn.execute(
            "INSERT INTO egress_log (payload_id, timestamp_utc, byte_size, destination, result, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
            (payload_id, now_utc, len(payload_json.encode("utf-8")), destination, result, payload_json),
        )
        self.conn.commit()

    def mark_retry(self, payload_id: str, attempts: int, destination: str, payload_json: str, status_code: int) -> float:
        now_mono = time.monotonic()
        # Deterministic jitter derived from payload_id hash + exponential backoff capped at 60s
        jitter = (int(hashlib.sha256(payload_id.encode("utf-8")).hexdigest()[:4], 16) % 1000) / 1000.0
        delay = min(60.0, (2.0 ** min(attempts, 5)) + jitter)
        next_mono = now_mono + delay
        now_utc = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            "UPDATE outbound_queue SET attempts = ?, next_retry_mono = ? WHERE payload_id = ?",
            (attempts + 1, next_mono, payload_id),
        )
        self.conn.execute(
            "INSERT INTO egress_log (payload_id, timestamp_utc, byte_size, destination, result, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
            (payload_id, now_utc, len(payload_json.encode("utf-8")), destination, f"BUFFERED_RETRY_{status_code}", payload_json),
        )
        self.conn.commit()
        return delay

    def queue_depth(self) -> int:
        row = self.conn.execute("SELECT COUNT(*) FROM outbound_queue").fetchone()
        return int(row[0]) if row else 0

    def prune_expired_raw(self) -> int:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=self.retention_days)).isoformat()
        cur = self.conn.execute("DELETE FROM raw_preview WHERE captured_at_utc < ?", (cutoff,))
        self.conn.commit()
        return int(cur.rowcount)

    def log_local_audit(self, action: str, detail: str) -> None:
        self.conn.execute(
            "INSERT INTO local_audit (timestamp_utc, action, detail) VALUES (?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(), action, detail),
        )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()
