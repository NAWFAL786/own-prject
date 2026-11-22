"""
Step 3: Tier 1 Source Adapters (Live Telemetry + Organizer Stream Replay Adapter).
Every sample returned carries explicit source="live" or source="simulated" plus
capture timestamp_utc and source_timezone. Raw auth/syslog lines are summarized locally
and never forwarded to Tier 2.
"""
from __future__ import annotations

import http.client
import json
import os
import socket
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class HostMetricsAdapter:
    name = "host"
    source = "live"

    def __init__(self) -> None:
        self._prev_cpu: tuple[int, int] | None = None
        self._prev_net: tuple[int, int, float] | None = None

    def read_cpu_percent(self) -> float | None:
        try:
            with open("/proc/stat", "r", encoding="utf-8") as f:
                parts = [int(x) for x in f.readline().split()[1:8]]
            idle = parts[3] + parts[4]
            total = sum(parts)
            if self._prev_cpu is None:
                self._prev_cpu = (total, idle)
                return None
            pt, pi = self._prev_cpu
            self._prev_cpu = (total, idle)
            dt, di = total - pt, idle - pi
            if dt <= 0:
                return None
            return round(((dt - di) / dt) * 100.0, 2)
        except Exception:
            return None

    def read_ram_percent(self) -> float | None:
        try:
            mem: dict[str, int] = {}
            with open("/proc/meminfo", "r", encoding="utf-8") as f:
                for line in f:
                    k, v = line.split(":", 1)
                    mem[k.strip()] = int(v.strip().split()[0])
            total = mem.get("MemTotal", 0)
            avail = mem.get("MemAvailable", mem.get("MemFree", 0))
            if total <= 0:
                return None
            return round(((total - avail) / total) * 100.0, 2)
        except Exception:
            return None

    def read_disk_percent(self) -> float | None:
        try:
            st = os.statvfs("/")
            total = st.f_blocks * st.f_frsize
            avail = st.f_bavail * st.f_frsize
            if total <= 0:
                return None
            return round(((total - avail) / total) * 100.0, 2)
        except Exception:
            return None

    def read_net_rx_bps(self, now_mono: float) -> float | None:
        try:
            rx_total = 0
            tx_total = 0
            with open("/proc/net/dev", "r", encoding="utf-8") as f:
                lines = f.readlines()[2:]
            for line in lines:
                iface, rest = line.split(":", 1)
                if iface.strip() == "lo":
                    continue
                cols = rest.split()
                rx_total += int(cols[0])
                tx_total += int(cols[8])
            if self._prev_net is None:
                self._prev_net = (rx_total, tx_total, now_mono)
                return None
            prx, _ptx, ptime = self._prev_net
            self._prev_net = (rx_total, tx_total, now_mono)
            elapsed = now_mono - ptime
            if elapsed <= 0 or rx_total < prx:
                return None
            return round((rx_total - prx) / elapsed, 2)
        except Exception:
            return None

    def collect(self, now_mono: float) -> list[dict[str, Any]]:
        ts_utc = datetime.now(timezone.utc).isoformat()
        tz = time.tzname[0] or "UTC"
        out: list[dict[str, Any]] = []
        for metric_name, value, unit in (
            ("cpu_total_percent", self.read_cpu_percent(), "%"),
            ("ram_usage_percent", self.read_ram_percent(), "%"),
            ("disk_usage_percent", self.read_disk_percent(), "%"),
            ("net_rx_bytes_per_sec", self.read_net_rx_bps(now_mono), "B/s"),
        ):
            if value is None:
                continue
            out.append(
                {
                    "metric_name": metric_name,
                    "metric_value": value,
                    "unit": unit,
                    "timestamp_utc": ts_utc,
                    "source_timezone": tz,
                    "connector": self.name,
                    "source": self.source,
                    "event_category": "metric_sample",
                }
            )
        return out


class LatencyProbeAdapter:
    name = "latency"
    source = "live"

    def __init__(self, host: str = "127.0.0.1", port: int = 3000, probes: int = 10) -> None:
        self.host = host
        self.port = port
        self.probes = probes

    def collect(self) -> list[dict[str, Any]]:
        ts_utc = datetime.now(timezone.utc).isoformat()
        tz = time.tzname[0] or "UTC"
        rtts: list[float] = []
        losses = 0
        for _ in range(self.probes):
            t0 = time.perf_counter()
            try:
                with socket.create_connection((self.host, self.port), timeout=0.6):
                    rtts.append((time.perf_counter() - t0) * 1000.0)
            except OSError:
                losses += 1
        loss_pct = round((losses / self.probes) * 100.0, 2)
        samples: list[dict[str, Any]] = [
            {
                "metric_name": "packet_loss_percent",
                "metric_value": loss_pct,
                "unit": "%",
                "timestamp_utc": ts_utc,
                "source_timezone": tz,
                "connector": self.name,
                "source": self.source,
                "event_category": "metric_sample",
            }
        ]
        if rtts:
            avg_ms = round(sum(rtts) / len(rtts), 3)
            samples.append(
                {
                    "metric_name": "latency_avg_ms",
                    "metric_value": avg_ms,
                    "unit": "ms",
                    "timestamp_utc": ts_utc,
                    "source_timezone": tz,
                    "connector": self.name,
                    "source": self.source,
                    "event_category": "metric_sample",
                }
            )
        return samples


class ServicePortAdapter:
    name = "service"
    source = "live"

    def __init__(self, host: str = "127.0.0.1", port: int = 3000, path: str = "/api/health") -> None:
        self.host = host
        self.port = port
        self.path = path

    def collect(self) -> list[dict[str, Any]]:
        ts_utc = datetime.now(timezone.utc).isoformat()
        tz = time.tzname[0] or "UTC"
        t0 = time.perf_counter()
        up = 0.0
        elapsed_ms: float | None = None
        try:
            conn = http.client.HTTPConnection(self.host, self.port, timeout=1.5)
            conn.request("GET", self.path, headers={"User-Agent": "Aurelis-Tier1/1.0"})
            resp = conn.getresponse()
            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 3)
            up = 100.0 if resp.status == 200 else 0.0
            conn.close()
        except Exception:
            up = 0.0

        out: list[dict[str, Any]] = [
            {
                "metric_name": "service_availability_percent",
                "metric_value": up,
                "unit": "%",
                "timestamp_utc": ts_utc,
                "source_timezone": tz,
                "connector": self.name,
                "source": self.source,
                "event_category": "metric_sample",
            }
        ]
        if elapsed_ms is not None:
            out.append(
                {
                    "metric_name": "service_response_time_ms",
                    "metric_value": elapsed_ms,
                    "unit": "ms",
                    "timestamp_utc": ts_utc,
                    "source_timezone": tz,
                    "connector": self.name,
                    "source": self.source,
                    "event_category": "metric_sample",
                }
            )
        return out


class AuthSyslogAdapter:
    """
    Tails local auth/syslog file in Tier 1 only and emits aggregated counts/summaries.
    Repeated failed logins generate an auth_failure_burst summary, never raw lines.
    """

    name = "logs"
    source = "live"

    def __init__(self, log_path: Path, burst_threshold: int = 5) -> None:
        self.log_path = log_path
        self.burst_threshold = burst_threshold
        self._offset_lines = 0

    def analyze_lines(self, lines: list[str]) -> list[dict[str, Any]]:
        ts_utc = datetime.now(timezone.utc).isoformat()
        tz = time.tzname[0] or "UTC"
        failed_logins = sum(
            1 for ln in lines if "failed_login" in ln.lower() or "4625" in ln or "invalid password" in ln.lower()
        )
        errors = sum(1 for ln in lines if "error" in ln.lower() or "critical" in ln.lower())

        out = [
            {
                "metric_name": "log_failed_login_count",
                "metric_value": float(failed_logins),
                "unit": "count",
                "timestamp_utc": ts_utc,
                "source_timezone": tz,
                "connector": self.name,
                "source": self.source,
                "event_category": "auth_failure_burst" if failed_logins >= self.burst_threshold else "metric_sample",
                "severity": "high" if failed_logins >= self.burst_threshold else "low",
                "alert_context": (
                    f"auth_failure_burst count={failed_logins} (raw lines scrubbed locally)"
                    if failed_logins >= self.burst_threshold
                    else f"logs:failed_login_count={failed_logins}"
                ),
            },
            {
                "metric_name": "log_error_count",
                "metric_value": float(errors),
                "unit": "count",
                "timestamp_utc": ts_utc,
                "source_timezone": tz,
                "connector": self.name,
                "source": self.source,
                "event_category": "metric_sample",
                "severity": "medium" if errors >= 5 else "low",
                "alert_context": f"logs:error_count={errors}",
            },
        ]
        return out

    def collect(self) -> list[dict[str, Any]]:
        if not self.log_path.exists():
            return self.analyze_lines([])
        lines = self.log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        new_lines = lines[self._offset_lines :]
        self._offset_lines = len(lines)
        return self.analyze_lines(new_lines)


class OrganizerReplayAdapter:
    """
    Mandatory organizer-provided telemetry stream replay adapter.
    Reads JSONL records and preserves event timestamps while tagging source="simulated".
    """

    name = "organizer_replay"
    source = "simulated"

    def __init__(self, stream_path: Path) -> None:
        self.stream_path = stream_path

    def load_records(self) -> list[dict[str, Any]]:
        if not self.stream_path.exists():
            return []
        records: list[dict[str, Any]] = []
        for raw_line in self.stream_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line:
                continue
            item = json.loads(line)
            # Never label organizer replay data as live
            item["source"] = "simulated"
            item.setdefault("connector", self.name)
            item.setdefault("source_timezone", "UTC")
            item.setdefault("timestamp_utc", datetime.now(timezone.utc).isoformat())
            records.append(item)
        return records
