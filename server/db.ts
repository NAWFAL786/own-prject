import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), '.aurelis_data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const TIER2_DB_PATH = path.join(DATA_DIR, 'tier2_saas.db');
export const TIER1_DB_PATH = path.join(DATA_DIR, 'tier1_collector.db');
export const OUTAGE_FLAG_PATH = path.join(DATA_DIR, 'collector_outage.flag');
export const EVENT_LOG_PATH = path.join(DATA_DIR, 'aurelis_events.log');
export const ORGANIZER_STREAM_PATH = path.resolve(process.cwd(), 'collector/data/organizer_stream.jsonl');

export const db = new Database(TIER2_DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function ensureColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function appendAuditLog(
  tenantId: string,
  siteId: string | null,
  tier: 'Tier 1' | 'Tier 2',
  actor: string,
  action: string,
  detail: string,
  source: 'live' | 'simulated'
): void {
  const ts = new Date().toISOString();
  const prev = db
    .prepare('SELECT entry_hash FROM audit_logs WHERE tenant_id = ? ORDER BY id DESC LIMIT 1')
    .get(tenantId) as { entry_hash: string | null } | undefined;
  const prevHash = prev?.entry_hash || 'GENESIS';
  const entryHash = crypto
    .createHash('sha256')
    .update(`${prevHash}|${tenantId}|${siteId || ''}|${tier}|${actor}|${action}|${detail}|${source}|${ts}`)
    .digest('hex');

  db.prepare(
    `INSERT INTO audit_logs (tenant_id, site_id, tier, actor, action, detail, source, prev_hash, entry_hash, timestamp_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(tenantId, siteId, tier, actor, action, detail, source, prevHash, entryHash, ts);
}

export function initSchemaAndSeed(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sector_tag TEXT NOT NULL,
      compliance_profile TEXT NOT NULL DEFAULT 'gdpr',
      default_region TEXT NOT NULL,
      created_at_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_id TEXT PRIMARY KEY,
      organization_name TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT 'AURELIS',
      logo_data_url TEXT,
      country_code TEXT NOT NULL DEFAULT 'IN',
      region TEXT NOT NULL DEFAULT 'ap-south-1',
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      industry TEXT NOT NULL DEFAULT 'it',
      compliance_profile TEXT NOT NULL DEFAULT 'gdpr',
      retention_days INTEGER NOT NULL DEFAULT 7,
      thresholds_json TEXT NOT NULL,
      remediation_policy_json TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      timezone TEXT NOT NULL,
      sector_tag TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      last_seen_utc TEXT,
      created_at_utc TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS operators (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      email_verified INTEGER NOT NULL DEFAULT 1,
      created_at_utc TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      operator_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at_utc TEXT NOT NULL,
      used_at_utc TEXT,
      created_at_utc TEXT NOT NULL,
      FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id TEXT PRIMARY KEY,
      operator_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at_utc TEXT NOT NULL,
      verified_at_utc TEXT,
      created_at_utc TEXT NOT NULL,
      FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS collectors (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL UNIQUE,
      collector_code TEXT NOT NULL,
      region TEXT NOT NULL,
      collector_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'online',
      revoked INTEGER NOT NULL DEFAULT 0,
      key_version INTEGER NOT NULL DEFAULT 1,
      cpu_usage_pct REAL NOT NULL DEFAULT 0,
      ram_usage_pct REAL NOT NULL DEFAULT 0,
      local_policy_json TEXT NOT NULL,
      last_seen_utc TEXT,
      created_at_utc TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS site_enrollment_tokens (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at_utc TEXT NOT NULL,
      used_at_utc TEXT,
      created_at_utc TEXT NOT NULL,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payload_receipts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      collector_id TEXT NOT NULL,
      payload_id TEXT NOT NULL,
      region TEXT NOT NULL,
      source TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      prev_attestation_sha256 TEXT,
      record_count INTEGER NOT NULL,
      sent_at_utc TEXT NOT NULL,
      received_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id, payload_id)
    );

    CREATE TABLE IF NOT EXISTS metrics_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      collector_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      metric_value REAL NOT NULL,
      unit TEXT NOT NULL,
      health_state TEXT NOT NULL,
      health_reason TEXT NOT NULL DEFAULT 'Within nominal baseline',
      source TEXT NOT NULL,
      connector TEXT NOT NULL,
      collection_interval INTEGER NOT NULL DEFAULT 5,
      source_timezone TEXT NOT NULL,
      timestamp_utc TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_lookup
      ON metrics_raw (tenant_id, site_id, metric_name, timestamp_utc DESC);

    CREATE TABLE IF NOT EXISTS health_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      previous_state TEXT,
      new_state TEXT NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      changed_at_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT,
      parent_incident_id TEXT,
      is_cross_site_parent INTEGER NOT NULL DEFAULT 0,
      affected_site_names TEXT NOT NULL DEFAULT '[]',
      source_id TEXT NOT NULL,
      cause_signal TEXT NOT NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      decision_mode TEXT NOT NULL,
      decision_reasoning_json TEXT NOT NULL,
      merged_alert_count INTEGER NOT NULL DEFAULT 1,
      correlation_explanation TEXT NOT NULL,
      manual_assignee TEXT,
      manual_evidence TEXT,
      source TEXT NOT NULL,
      opened_at_utc TEXT NOT NULL,
      acknowledged_at_utc TEXT,
      resolved_at_utc TEXT
    );

    CREATE TABLE IF NOT EXISTS incident_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      actor TEXT NOT NULL,
      detail TEXT NOT NULL,
      timestamp_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recommendations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      incident_id TEXT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      action_id TEXT NOT NULL,
      target_alias TEXT NOT NULL,
      why_flagged TEXT NOT NULL,
      contributing_signals_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      reasoning_path_json TEXT NOT NULL,
      suggested_action TEXT NOT NULL,
      rollback_plan TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      projected_impact TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      source TEXT NOT NULL,
      created_at_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      collector_id TEXT NOT NULL,
      incident_id TEXT,
      recommendation_id TEXT,
      action_id TEXT NOT NULL,
      target_alias TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL,
      nonce TEXT NOT NULL,
      signature_hmac TEXT NOT NULL,
      expires_at_epoch INTEGER NOT NULL,
      before_evidence_json TEXT,
      after_evidence_json TEXT,
      rollback_performed INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      created_at_utc TEXT NOT NULL,
      completed_at_utc TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      site_id TEXT,
      tier TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      source TEXT NOT NULL,
      prev_hash TEXT,
      entry_hash TEXT,
      timestamp_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_channels (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      target_label TEXT NOT NULL,
      quiet_hours TEXT NOT NULL DEFAULT '23:00-06:00',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at_utc TEXT NOT NULL
    );
  `);

  // Safe forward-migrations if an existing SQLite DB was created earlier
  ensureColumn('tenants', 'compliance_profile', "TEXT NOT NULL DEFAULT 'gdpr'");
  ensureColumn('operators', 'email_verified', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('collectors', 'revoked', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('collectors', 'key_version', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('metrics_raw', 'health_reason', "TEXT NOT NULL DEFAULT 'Within nominal baseline'");
  ensureColumn('incidents', 'manual_assignee', 'TEXT');
  ensureColumn('incidents', 'manual_evidence', 'TEXT');
  ensureColumn('jobs', 'rollback_performed', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('audit_logs', 'prev_hash', 'TEXT');
  ensureColumn('audit_logs', 'entry_hash', 'TEXT');

  const aurelisTenant = db.prepare("SELECT id FROM tenants WHERE id = 'tenant-aurelis'").get();
  if (!aurelisTenant) {
    seedAurelisCloudOpsData();
  }
}

function seedAurelisCloudOpsData(): void {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const tenantId = 'tenant-aurelis';

  db.prepare(
    `INSERT OR IGNORE INTO tenants (id, name, sector_tag, compliance_profile, default_region, created_at_utc)
     VALUES (?, ?, 'it', 'gdpr', 'ap-south-1', ?)`
  ).run(tenantId, 'Aurelis Cloud Ops', iso(-86400000));

  db.prepare(
    `INSERT OR IGNORE INTO tenant_settings (tenant_id, organization_name, product_name, country_code, region, timezone, industry, compliance_profile, retention_days, thresholds_json, remediation_policy_json, updated_at_utc)
     VALUES (?, 'Aurelis Cloud Ops', 'AURELIS', 'IN', 'ap-south-1', 'Asia/Kolkata', 'it', 'gdpr', 7, ?, ?, ?)`
  ).run(
    tenantId,
    JSON.stringify({ cpu_fair: 78, cpu_poor: 90, latency_fair_ms: 60, latency_poor_ms: 120, packet_loss_fair: 1.5 }),
    JSON.stringify({
      dry_run: false,
      mode: 'approval_required',
      kill_switch: false,
      allowed_actions: ['flush_dns_cache', 'rotate_logs', 'clear_temp_files', 'restart_service', 'escalate_to_human'],
    }),
    iso(-86400000)
  );

  const sites = [
    {
      id: 'site-blr-hq',
      name: 'Bengaluru Office (Primary Live)',
      region: 'ap-south-1',
      timezone: 'Asia/Kolkata',
      sector_tag: 'it',
      status: 'connected',
      collectorId: 'col-local-primary',
      code: 'COL-BLR-01',
    },
    {
      id: 'site-bom-dc',
      name: 'Mumbai Data Center',
      region: 'ap-south-1',
      timezone: 'Asia/Kolkata',
      sector_tag: 'it',
      status: 'connected',
      collectorId: 'col-bom-dc-02',
      code: 'COL-BOM-02',
    },
    {
      id: 'site-fra-cloud',
      name: 'Frankfurt Cloud Hub',
      region: 'eu-central-1',
      timezone: 'Europe/Berlin',
      sector_tag: 'it',
      status: 'degraded',
      collectorId: 'col-fra-eu-03',
      code: 'COL-FRA-03',
    },
  ];

  const defaultPolicy = JSON.stringify({
    mode: 'approval_required',
    kill_switch: false,
    max_actions_per_hour: 6,
    maintenance_window: '00:00-23:59 UTC',
    allowed_actions: ['flush_dns_cache', 'rotate_logs', 'clear_temp_files', 'restart_service', 'escalate_to_human'],
  });

  for (const s of sites) {
    db.prepare(
      `INSERT OR IGNORE INTO sites (id, tenant_id, name, region, timezone, sector_tag, status, last_seen_utc, created_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(s.id, tenantId, s.name, s.region, s.timezone, s.sector_tag, s.status, iso(-4000), iso(-86400000));

    db.prepare(
      `INSERT OR IGNORE INTO collectors (id, tenant_id, site_id, collector_code, region, collector_version, status, cpu_usage_pct, ram_usage_pct, local_policy_json, last_seen_utc, created_at_utc)
       VALUES (?, ?, ?, ?, ?, '2.5.0', ?, ?, ?, ?, ?, ?)`
    ).run(
      s.collectorId,
      tenantId,
      s.id,
      s.code,
      s.region,
      s.status === 'degraded' ? 'degraded' : 'online',
      s.id === 'site-blr-hq' ? 1.4 : 2.2,
      s.id === 'site-blr-hq' ? 3.2 : 4.6,
      defaultPolicy,
      iso(-4000),
      iso(-86400000)
    );
  }

  const insertMetric = db.prepare(
    `INSERT INTO metrics_raw (tenant_id, site_id, collector_id, source_id, metric_name, metric_value, unit, health_state, health_reason, source, connector, collection_interval, source_timezone, timestamp_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'simulated', ?, 60, ?, ?)`
  );

  const tx = db.transaction(() => {
    for (let i = 20; i >= 1; i--) {
      const ts = iso(-i * 150000);
      const wave = Math.sin(i * 0.5);
      insertMetric.run(tenantId, 'site-bom-dc', 'col-bom-dc-02', 'src_bom_core_01', 'cpu_total_percent', Number((42 + wave * 8).toFixed(2)), '%', 'Excellent', 'Within IT baseline', 'host', 'Asia/Kolkata', ts);
      insertMetric.run(tenantId, 'site-bom-dc', 'col-bom-dc-02', 'src_bom_core_01', 'ram_usage_percent', Number((58 + wave * 4).toFixed(2)), '%', 'Good', 'Minor variance within band', 'host', 'Asia/Kolkata', ts);
      insertMetric.run(tenantId, 'site-bom-dc', 'col-bom-dc-02', 'src_bom_core_01', 'disk_usage_percent', 49.2, '%', 'Excellent', 'Nominal disk headroom', 'host', 'Asia/Kolkata', ts);
      insertMetric.run(tenantId, 'site-bom-dc', 'col-bom-dc-02', 'src_bom_core_01', 'latency_avg_ms', Number((20 + Math.abs(wave) * 11).toFixed(2)), 'ms', 'Good', 'Nominal metro RTT', 'latency', 'Asia/Kolkata', ts);
      insertMetric.run(tenantId, 'site-bom-dc', 'col-bom-dc-02', 'src_bom_core_01', 'packet_loss_percent', 0.0, '%', 'Excellent', 'Zero packet loss', 'latency', 'Asia/Kolkata', ts);
      insertMetric.run(tenantId, 'site-bom-dc', 'col-bom-dc-02', 'src_bom_core_01', 'service_availability_percent', 100.0, '%', 'Excellent', 'All probes HTTP 200', 'service', 'Asia/Kolkata', ts);

      const spike = i <= 4 ? 52 : 0;
      insertMetric.run(tenantId, 'site-fra-cloud', 'col-fra-eu-03', 'src_fra_edge_09', 'cpu_total_percent', Number((66 + wave * 10 + spike * 0.25).toFixed(2)), '%', spike ? 'Fair' : 'Good', spike ? 'Elevated CPU above 78% threshold' : 'Normal load', 'host', 'Europe/Berlin', ts);
      insertMetric.run(tenantId, 'site-fra-cloud', 'col-fra-eu-03', 'src_fra_edge_09', 'ram_usage_percent', Number((72 + wave * 5).toFixed(2)), '%', 'Good', 'Steady memory utilization', 'host', 'Europe/Berlin', ts);
      insertMetric.run(tenantId, 'site-fra-cloud', 'col-fra-eu-03', 'src_fra_edge_09', 'disk_usage_percent', 64.8, '%', 'Good', 'Adequate volume space', 'host', 'Europe/Berlin', ts);
      insertMetric.run(tenantId, 'site-fra-cloud', 'col-fra-eu-03', 'src_fra_edge_09', 'latency_avg_ms', Number((31 + Math.abs(wave) * 10 + spike).toFixed(2)), 'ms', spike ? 'Fair' : 'Good', spike ? 'WAN RTT +52ms above EWMA baseline' : 'Nominal EU transit', 'latency', 'Europe/Berlin', ts);
      insertMetric.run(tenantId, 'site-fra-cloud', 'col-fra-eu-03', 'src_fra_edge_09', 'packet_loss_percent', spike ? 2.1 : 0.0, '%', spike ? 'Fair' : 'Excellent', spike ? 'Packet loss >= 1.5%' : 'Zero packet loss', 'latency', 'Europe/Berlin', ts);
      insertMetric.run(tenantId, 'site-fra-cloud', 'col-fra-eu-03', 'src_fra_edge_09', 'service_availability_percent', spike ? 98.5 : 100.0, '%', spike ? 'Fair' : 'Excellent', spike ? 'Transient timeout on 1 probe' : 'Service healthy', 'service', 'Europe/Berlin', ts);
    }
  });
  tx();

  db.prepare(
    `INSERT INTO health_history (tenant_id, site_id, source_id, previous_state, new_state, reason, source, changed_at_utc)
     VALUES (?, 'site-fra-cloud', 'src_fra_edge_09', 'Good', 'Fair', 'WAN RTT exceeded 60ms EWMA threshold (+52ms spike)', 'simulated', ?)`
  ).run(tenantId, iso(-600000));

  const parentId = 'inc-cross-wan-001';
  db.prepare(
    `INSERT OR IGNORE INTO incidents (id, tenant_id, site_id, parent_incident_id, is_cross_site_parent, affected_site_names, source_id, cause_signal, title, severity, status, decision_mode, decision_reasoning_json, merged_alert_count, correlation_explanation, source, opened_at_utc)
     VALUES (?, ?, NULL, NULL, 1, ?, 'multi_site_correlator', 'wan_latency_zscore_breach', 'Correlated Cross-Site WAN Transit Latency Surge', 'high', 'open', 'ASK_APPROVAL', ?, 5, ?, 'simulated', ?)`
  ).run(
    parentId,
    tenantId,
    JSON.stringify(['Mumbai Data Center', 'Frankfurt Cloud Hub']),
    JSON.stringify({
      cause: 'Upstream transit peering jitter exceeding 3.1 sigma baseline across two sites within 5m window',
      confidence: 0.91,
      policy_checked: ['allow_list: passed', 'kill_switch: off', 'compliance: gdpr', 'risk_level: medium'],
      outcome: 'ASK_APPROVAL — DNS/resolver cache flush queued for operator confirmation.',
    }),
    'Merged 5 latency & packet-loss alerts across Mumbai Data Center and Frankfurt Cloud Hub sharing a 5-minute correlation window.',
    iso(-900000)
  );

  db.prepare(
    `INSERT OR IGNORE INTO recommendations (id, tenant_id, site_id, incident_id, category, title, action_id, target_alias, why_flagged, contributing_signals_json, confidence, reasoning_path_json, suggested_action, rollback_plan, risk_level, projected_impact, status, source, created_at_utc)
     VALUES (?, ?, 'site-blr-hq', ?, 'Network & Latency', 'Flush Local DNS Resolver Cache on Bengaluru Gateway', 'flush_dns_cache', 'blr-gateway-01', 'Resolver cache entries showed elevated lookup jitter during peering shift.', ?, 0.91, ?, 'Dispatch signed Tier 1 job flush_dns_cache and verify latency_avg_ms returns to baseline.', 'Restore previous resolver table and mark resolution failed if post-check fails.', 'medium', '-24ms avg latency', 'pending', 'simulated', ?)`
  ).run(
    'rec-dns-flush-01',
    tenantId,
    parentId,
    JSON.stringify(['latency_avg_ms +52ms', 'packet_loss_percent > 1.5%', 'cross_site_correlation=true']),
    JSON.stringify([
      '1. Detected 3.1-sigma latency rise from metadata stream',
      '2. Confirmed host CPU < 55% (no local compute bottleneck)',
      '3. Matched safe allow-listed runbook action flush_dns_cache',
      '4. Verified GDPR compliance & local kill_switch OFF',
    ]),
    iso(-850000)
  );

  db.prepare(
    `INSERT OR IGNORE INTO notification_channels (id, tenant_id, site_id, channel_type, target_label, quiet_hours, enabled, created_at_utc)
     VALUES ('ch-mailhog-01', ?, 'site-blr-hq', 'email', 'MailHog Local SMTP (127.0.0.1:1025)', '23:00-06:00', 1, ?)`
  ).run(tenantId, iso(-86400000));

  appendAuditLog(
    tenantId,
    'site-blr-hq',
    'Tier 2',
    'system-bootstrap',
    'workspace_initialized',
    'Initialized Aurelis Cloud Ops (IT / GDPR) zero-config Tier 2 workspace with tamper-evident audit hash chain.',
    'simulated'
  );

  if (!fs.existsSync(EVENT_LOG_PATH)) {
    fs.writeFileSync(EVENT_LOG_PATH, `${iso(-60000)} INFO aurelis_boot status=ready\n`, 'utf8');
  }
}

export function createSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
