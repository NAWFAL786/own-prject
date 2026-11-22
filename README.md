# AURELIS — Smart Observability (CICADA 2026)

A two-tier, metadata-only, multi-tenant AIOps observability platform where raw logs, payloads, and credentials **never leave the customer perimeter (Tier 1)** and only redacted, allow-listed metadata reaches the **central multi-tenant SaaS (Tier 2)**.

---

## Architecture & Trust Boundaries

```
+-------------------------------------------------------------------+
| TIER 1: Customer Environment / Local Collector (Python Daemon)     |
|                                                                   |
|  Host (/proc, statvfs) ──┐                                        |
|  10x TCP Latency Probe ──┼──> Normalize ──> Local Redactor        |
|  Local Auth/Syslog Tail ─┤    (GDPR/PCI/    (scrubs secrets/PII)  |
|  Organizer Stream Replay ┘     HIPAA/RBI)          │              |
|                                                    ▼              |
|  SQLite Outage Buffer  <── Egress Log <── Strict 17-Field Allow-List
|  (Backoff + UUID)          (raw_preview    (drops raw lines/hosts) |
+-----------------------------------┬-------------------------------+
                                    │ HTTPS/TLS + Bearer Key + HMAC-SHA256
                                    │ Outbound Push Only (No Inbound Firewall)
                                    ▼
+-------------------------------------------------------------------+
| TIER 2: Central Multi-Tenant SaaS Platform (Express / FastAPI)    |
|                                                                   |
|  HMAC + Replay Guard ──> Pydantic/Schema Allow-List Gate (HTTP 400)|
|         │                                                         |
|         ▼                                                         |
|  Residency Check + Tenant Isolation (RLS) + Dedupe (payload_id)   |
|         │                                                         |
|         ├──> Pluggable Storage (SQLite Preview | Postgres 16 | Supabase)
|         ├──> Metadata-Only AIOps (EWMA/z-score + 5m Correlator)   |
|         ├──> Fix-or-Notify (AUTO_FIX / ASK_APPROVAL / NOTIFY_ONLY)|
|         └──> SHA-256 Tamper-Evident Audit Hash Chain              |
+-------------------------------------------------------------------+
```

### Default Workspace & Profiles
- **Default Workspace**: `Aurelis Cloud Ops` (`IT` industry, `GDPR` compliance profile, `7`-day Tier 1 raw retention)
- **Telemetry Provenance**: Every metric, incident, recommendation, and receipt explicitly carries `source = "live"` or `source = "simulated"`, filterable globally in the header via **All Sources | Live | Simulated**.

---

## Folder Structure

```
├── collector/
│   ├── config/redaction_rules.json     # Tier 1 secret/PII regex rules
│   ├── data/organizer_stream.jsonl     # Replay adapter dataset (tagged simulated)
│   └── daemon.py                       # Live Tier 1 local collector + job poller
├── collector_app/
│   ├── buffer/sqlite_queue.py          # Persistent outage queue + exponential backoff + egress log
│   ├── pipeline/runner.py              # Ordered Tier 1 pipeline
│   ├── policy/allow_list.py            # 17-field strict allow-list filter
│   ├── redaction/redactor.py           # GDPR/PCI-DSS/HIPAA/RBI redactor + source pseudonymizer
│   └── sources/adapters.py             # Host, TCP latency, HTTP probe, auth burst, replay adapters
├── saas_app/
│   ├── aiops/engine.py                 # Rolling EWMA/z-score anomaly + Fix-or-Notify engine
│   ├── db/storage.py                   # Pluggable STORAGE_BACKEND=postgres|supabase
│   └── ingest/
│       ├── auth.py                     # Collector key + HMAC-SHA256 replay protection
│       └── schemas.py                  # Strict extra="forbid" schema + unredacted secret guard
├── db/
│   ├── schema.sql                      # 18-table Postgres/Timescale-ready schema + residency triggers
│   ├── rls_policies.sql                # Dual Postgres session RLS & Supabase JWT RLS
│   └── seed_simulated.sql              # Simulated reference multi-tenant dataset
├── server/db.ts                        # Embedded SQLite Tier 2 schema + hash-chained audit logs
├── server.ts                           # Express API + Vite dev server + auto-spawned Tier 1 daemon
├── src/                                # React + Tailwind + Recharts + Lucide Gold/White/Black UI
├── docker-compose.yml                  # Postgres 16 + MailHog (:8025) + SaaS + Python Collector
└── tests/                              # End-to-end schema, allow-list, collector & AIOps tests
```

---

## Quick Start

### Option A: Zero-Config Embedded Preview (No External Accounts or `.env` Required)
```bash
npm install
npm run dev
```
1. Open `http://localhost:3000`.
2. Click **Create Operator** (select **Aurelis Cloud Ops (IT / GDPR)** or create your own isolated organization with Country -> Region/Timezone auto-mapping).
3. The Express backend automatically bootstraps CSPRNG session/collector secrets, initializes `.aurelis_data/tier2_saas.db`, and spawns `python3 collector/daemon.py` streaming live host telemetry every 5 seconds.

### Option B: Docker Compose (Postgres 16 + MailHog SMTP + Tier 1 Collector)
```bash
docker compose up --build
```
- **Dashboard / API**: `http://localhost:3000`
- **Postgres 16**: `localhost:5432` (`STORAGE_BACKEND=postgres`, RLS enabled)
- **MailHog Web UI**: `http://localhost:8025` (captures operator verification & password reset emails sent via `SMTP_HOST=127.0.0.1:1025`)

---

## Running Automated Tests
```bash
python3 -m unittest discover -s tests -p "test_*.py" -v
npm run lint
npm run build
```

---

## 8-Scenario Demo Script (Also Triggerable in **AI Intelligence**)
1. **Secret in Raw Log -> Redacted Locally**: Open **Privacy & Egress Proof**, enter a log containing a `password=`, `Bearer` JWT, email, and `10.x` IP, and click **Run Proof**. Tier 1 scrubs secrets locally and drops unapproved fields; Tier 2 rejects non-allow-listed keys with `HTTP 400`.
2. **SaaS Outage -> Buffer & Resume Parity**: Open **Collector Management**, click **Simulate SaaS Outage**, watch `outbound_queue` climb, then click **Reconnect SaaS & Flush Queue**. Verify `matchedReceivedCount / sentPayloadCount = 100%` in **AI Intelligence** and **Privacy & Egress Proof**.
3. **Failed-Login Burst -> Summary Only**: Trigger **Failed-Login Burst -> Summary Only** in **AI Intelligence**; 27 auth failures stay in `.aurelis_data/aurelis_events.log` while Tier 1 emits only a count summary (`event_category="auth_failure_burst"`).
4. **WAN Latency Rise**: Trigger **WAN Latency Z-Score Spike** to observe > 3.0-sigma deviation incident and Fix-or-Notify recommendation.
5. **CPU / RAM Deviation -> Explained Anomaly**: Trigger **CPU & Memory Baseline Deviation** and inspect Z-score baseline stats.
6. **Many Alerts -> One Incident**: Trigger **Many Alerts -> One Incident** (or inspect seeded `Correlated Cross-Site WAN Transit Latency Surge`) showing 5-minute window alert correlation.
7. **Duplicate & Out-of-Order Delivery**: Trigger **Duplicate & Out-of-Order Replay**; backdated event is ordered by `timestamp_utc` and duplicate `payload_id` is ignored via `UNIQUE (tenant_id, payload_id)`.
8. **Signed Remediation & Rollback**: In **Recommendations**, click **Approve & Dispatch Signed Job**, watch Tier 1 poll & report `verified_resolved` within ~5 seconds, or test **Rollback** and inspect the SHA-256 hash-chained **Audit Logs**.

---

## Deployment Checklist (External Hosting / Optional Supabase)
All endpoints and credentials default cleanly to local auto-bootstrap, and can be switched for cloud hosting via environment variables without editing source code:
- `VITE_SAAS_API_URL` / `VITE_COLLECTOR_API_URL`: Leave unset for single-origin Express, or point to split API hosts.
- `STORAGE_BACKEND`: `postgres` (default) or `supabase`.
- `DATABASE_URL`: Postgres connection string (when `STORAGE_BACKEND=postgres`).
- `SUPABASE_URL` & `SUPABASE_SERVICE_ROLE_KEY`: Server-side only (never `VITE_*`) if using hosted Supabase.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`: Point from local MailHog (`127.0.0.1:1025`) to production SMTP relay.

---

## Honest Limitations
- **Autonomous Remediation Scope**: Tier 1 executes allow-listed local verification checks cleanly inside the sandbox rather than modifying host OS network/systemd state as root.
- **Regional Residency Simulation**: Multi-region behavior (`ap-south-1`, `eu-central-1`, `us-east-1`, `eu-west-1`) is enforced logically at the API and database trigger layer (`sites.region == collectors.region`), rather than across separate physical cloud deployments.
- **Production Hardening Next Steps**: Production deployment requires real CA-signed mTLS/TLS certificates, automated KMS collector key rotation, and Postgres connection pooling + TimescaleDB hypertables at high cardinality.
