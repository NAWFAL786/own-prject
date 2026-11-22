-- AURELIS Secure AIOps Observability Platform (CICADA 2026)
-- Step 1: Complete Multi-Tenant & Multi-Site PostgreSQL / Supabase Schema
-- Works identically on local PostgreSQL (STORAGE_BACKEND=postgres) and Supabase (STORAGE_BACKEND=supabase).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Tenants (Companies)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sector_tag TEXT NOT NULL CHECK (sector_tag IN ('it', 'healthcare', 'banking', 'retail', 'manufacturing', 'telecom')),
  default_region TEXT NOT NULL CHECK (default_region IN ('us-east-1', 'us-west-2', 'eu-central-1', 'eu-west-1', 'ap-south-1')),
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 3650),
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- 2. Sites (Locations per Tenant with Per-Site Data Residency)
CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('us-east-1', 'us-west-2', 'eu-central-1', 'eu-west-1', 'ap-south-1')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  sector_tag TEXT NOT NULL CHECK (sector_tag IN ('it', 'healthcare', 'banking', 'retail', 'manufacturing', 'telecom')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'degraded', 'offline')),
  last_seen_utc TIMESTAMPTZ,
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  UNIQUE (tenant_id, name),
  UNIQUE (id, tenant_id),
  UNIQUE (id, tenant_id, region)
);

-- 3. Operators & Site-Scoped RBAC
CREATE TABLE IF NOT EXISTS operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('tenant_admin', 'site_admin', 'viewer')),
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS operator_site_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  site_id UUID NOT NULL,
  site_role TEXT NOT NULL CHECK (site_role IN ('site_admin', 'viewer')),
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  UNIQUE (operator_id, site_id),
  FOREIGN KEY (site_id, tenant_id) REFERENCES sites(id, tenant_id) ON DELETE CASCADE
);

-- 4. Collectors (1-to-1 strictly bound to exactly one Site + Region)
CREATE TABLE IF NOT EXISTS collectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  site_id UUID NOT NULL UNIQUE,
  collector_code TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('us-east-1', 'us-west-2', 'eu-central-1', 'eu-west-1', 'ap-south-1')),
  api_key_hash TEXT NOT NULL,
  hmac_secret_ref TEXT NOT NULL,
  collector_version TEXT NOT NULL,
  local_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_status TEXT NOT NULL DEFAULT 'synced' CHECK (config_status IN ('synced', 'pending', 'drift')),
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'degraded', 'offline')),
  cpu_usage_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  ram_usage_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_seen_utc TIMESTAMPTZ,
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  UNIQUE (tenant_id, collector_code),
  UNIQUE (id, site_id, tenant_id),
  FOREIGN KEY (site_id, tenant_id, region) REFERENCES sites(id, tenant_id, region) ON DELETE CASCADE
);

-- 5. Single-Use, 24-Hour Collector Enrollment Tokens
CREATE TABLE IF NOT EXISTS site_enrollment_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at_utc TIMESTAMPTZ NOT NULL,
  used_at_utc TIMESTAMPTZ,
  created_by UUID REFERENCES operators(id) ON DELETE SET NULL,
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (site_id, tenant_id) REFERENCES sites(id, tenant_id) ON DELETE CASCADE
);

-- 6. Assets (Pseudonymous infrastructure targets inside a Site)
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  site_id UUID NOT NULL,
  collector_id UUID NOT NULL,
  source_id TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('host', 'service', 'network', 'database', 'cloud', 'industry')),
  health_state TEXT NOT NULL DEFAULT 'Good' CHECK (health_state IN ('Excellent', 'Good', 'Fair', 'Poor')),
  source TEXT NOT NULL CHECK (source IN ('live', 'simulated')),
  last_seen_utc TIMESTAMPTZ,
  UNIQUE (tenant_id, site_id, source_id),
  FOREIGN KEY (collector_id, site_id, tenant_id) REFERENCES collectors(id, site_id, tenant_id) ON DELETE CASCADE
);

-- 7. Idempotent Payload Receipts & Cryptographic Attestation Chain
CREATE TABLE IF NOT EXISTS payload_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL,
  collector_id UUID NOT NULL,
  payload_id UUID NOT NULL,
  region TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live', 'simulated')),
  hmac_verified BOOLEAN NOT NULL DEFAULT TRUE,
  payload_sha256 TEXT NOT NULL,
  prev_attestation_sha256 TEXT,
  record_count INTEGER NOT NULL CHECK (record_count >= 0),
  sent_at_utc TIMESTAMPTZ NOT NULL,
  received_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  UNIQUE (tenant_id, payload_id),
  FOREIGN KEY (collector_id, site_id, tenant_id) REFERENCES collectors(id, site_id, tenant_id) ON DELETE CASCADE
);

-- 8. Metrics (Metadata-only time-series ordered by event timestamp_utc)
CREATE TABLE IF NOT EXISTS metrics (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL,
  collector_id UUID NOT NULL,
  payload_id UUID NOT NULL,
  source_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  health_state TEXT NOT NULL CHECK (health_state IN ('Excellent', 'Good', 'Fair', 'Poor')),
  source TEXT NOT NULL CHECK (source IN ('live', 'simulated')),
  connector TEXT NOT NULL,
  collection_interval INTEGER NOT NULL DEFAULT 5,
  source_timezone TEXT NOT NULL,
  timestamp_utc TIMESTAMPTZ NOT NULL,
  received_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (collector_id, site_id, tenant_id) REFERENCES collectors(id, site_id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_metrics_event_order
  ON metrics (tenant_id, site_id, metric_name, timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_source_event_order
  ON metrics (tenant_id, source_id, metric_name, timestamp_utc DESC);

-- 9. Events (Aggregated/redacted anomaly & auth-failure summaries; never raw log lines)
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL,
  collector_id UUID NOT NULL,
  payload_id UUID NOT NULL,
  source_id TEXT NOT NULL,
  event_category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  alert_context TEXT NOT NULL,
  health_state TEXT NOT NULL CHECK (health_state IN ('Excellent', 'Good', 'Fair', 'Poor')),
  source TEXT NOT NULL CHECK (source IN ('live', 'simulated')),
  source_timezone TEXT NOT NULL,
  timestamp_utc TIMESTAMPTZ NOT NULL,
  received_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (collector_id, site_id, tenant_id) REFERENCES collectors(id, site_id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_event_order
  ON events (tenant_id, site_id, timestamp_utc DESC);

-- 10. Incidents (Single-site + Cross-site Parent/Child + Fix-or-Notify Reasoning)
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID,
  parent_incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  is_cross_site_parent BOOLEAN NOT NULL DEFAULT FALSE,
  affected_site_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  source_id TEXT NOT NULL,
  cause_signal TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'investigating', 'resolved')),
  decision_mode TEXT NOT NULL CHECK (decision_mode IN ('AUTO_FIX', 'ASK_APPROVAL', 'NOTIFY_ONLY')),
  decision_reasoning JSONB NOT NULL DEFAULT '{}'::jsonb,
  merged_alert_count INTEGER NOT NULL DEFAULT 1,
  correlation_window_minutes INTEGER NOT NULL DEFAULT 5,
  correlation_explanation TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live', 'simulated')),
  opened_at_utc TIMESTAMPTZ NOT NULL,
  acknowledged_at_utc TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES operators(id) ON DELETE SET NULL,
  resolved_at_utc TIMESTAMPTZ,
  FOREIGN KEY (site_id, tenant_id) REFERENCES sites(id, tenant_id) ON DELETE CASCADE,
  CHECK (
    (is_cross_site_parent = TRUE AND site_id IS NULL)
    OR (is_cross_site_parent = FALSE AND site_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS incident_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  stage TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail TEXT NOT NULL,
  timestamp_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- 11. Explainable Recommendations
CREATE TABLE IF NOT EXISTS recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL,
  incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  action_id TEXT NOT NULL,
  target_alias TEXT NOT NULL,
  why_flagged TEXT NOT NULL,
  contributing_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reasoning_path JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggested_action TEXT NOT NULL,
  rollback_plan TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed_verified', 'failed')),
  source TEXT NOT NULL CHECK (source IN ('live', 'simulated')),
  decided_by UUID REFERENCES operators(id) ON DELETE SET NULL,
  decided_at_utc TIMESTAMPTZ,
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (site_id, tenant_id) REFERENCES sites(id, tenant_id) ON DELETE CASCADE
);

-- 12. Signed Remediation Jobs (Outbound-polled by Tier 1 Collector)
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  site_id UUID NOT NULL,
  collector_id UUID NOT NULL,
  incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  recommendation_id UUID REFERENCES recommendations(id) ON DELETE SET NULL,
  action_id TEXT NOT NULL,
  target_alias TEXT NOT NULL,
  params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'dispatched', 'running', 'verified_resolved', 'failed', 'rolled_back', 'rejected_policy', 'expired')),
  nonce TEXT NOT NULL UNIQUE,
  signature_ed25519 TEXT NOT NULL,
  expires_at_utc TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2),
  before_evidence JSONB,
  after_evidence JSONB,
  rollback_state JSONB,
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  completed_at_utc TIMESTAMPTZ,
  FOREIGN KEY (collector_id, site_id, tenant_id) REFERENCES collectors(id, site_id, tenant_id) ON DELETE CASCADE
);

-- 13. Health State History
CREATE TABLE IF NOT EXISTS health_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL,
  source_id TEXT NOT NULL,
  previous_state TEXT CHECK (previous_state IN ('Excellent', 'Good', 'Fair', 'Poor')),
  new_state TEXT NOT NULL CHECK (new_state IN ('Excellent', 'Good', 'Fair', 'Poor')),
  reason TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live', 'simulated')),
  changed_at_utc TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (site_id, tenant_id) REFERENCES sites(id, tenant_id) ON DELETE CASCADE
);

-- 14. Immutable Governance Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID,
  tier TEXT NOT NULL CHECK (tier IN ('Tier 1', 'Tier 2')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL CHECK (source IN ('live', 'simulated')),
  timestamp_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- 15. Metadata-Only Notification Channels & Deduplicated Threads
CREATE TABLE IF NOT EXISTS site_notification_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('email', 'slack', 'teams', 'webhook', 'in_app')),
  target_label TEXT NOT NULL,
  config_secret_ref TEXT,
  quiet_hours TEXT NOT NULL DEFAULT '23:00-06:00',
  escalation_minutes INTEGER NOT NULL DEFAULT 15,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (site_id, tenant_id) REFERENCES sites(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES site_notification_channels(id) ON DELETE CASCADE,
  external_thread_ref TEXT NOT NULL,
  last_notified_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  UNIQUE (incident_id, channel_id)
);

-- Database Triggers: Residency Enforcement & Single-Use Enrollment Tokens
CREATE OR REPLACE FUNCTION enforce_site_region_residency()
RETURNS TRIGGER AS $$
DECLARE
  expected_region TEXT;
BEGIN
  SELECT region INTO expected_region
  FROM sites
  WHERE id = NEW.site_id AND tenant_id = NEW.tenant_id;

  IF expected_region IS NULL THEN
    RAISE EXCEPTION 'Site % does not belong to tenant %', NEW.site_id, NEW.tenant_id;
  END IF;

  IF NEW.region <> expected_region THEN
    RAISE EXCEPTION 'Data residency violation: payload region % mismatches site region %', NEW.region, expected_region;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payload_residency ON payload_receipts;
CREATE TRIGGER trg_payload_residency
  BEFORE INSERT ON payload_receipts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_site_region_residency();

CREATE OR REPLACE FUNCTION enforce_single_use_enrollment_token()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.used_at_utc IS NOT NULL THEN
    RAISE EXCEPTION 'Enrollment token % has already been consumed', OLD.id;
  END IF;
  IF NEW.used_at_utc IS NOT NULL AND NEW.used_at_utc > OLD.expires_at_utc THEN
    RAISE EXCEPTION 'Enrollment token % is expired', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_single_use_enrollment_token ON site_enrollment_tokens;
CREATE TRIGGER trg_single_use_enrollment_token
  BEFORE UPDATE ON site_enrollment_tokens
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_use_enrollment_token();
