export type HealthState = 'Excellent' | 'Good' | 'Fair' | 'Poor';

export type DataSourceMode = 'all' | 'live' | 'simulated';

export type NavSection =
  | 'overview'
  | 'infrastructure'
  | 'environments'
  | 'collectors'
  | 'privacy'
  | 'incidents'
  | 'intelligence'
  | 'recommendations'
  | 'audit'
  | 'settings';

export interface PublicBranding {
  organizationName: string;
  productName: string;
  logoDataUrl: string | null;
}

export interface OperatorProfile {
  id: string;
  email: string;
  fullName: string;
  role: string;
  emailVerified?: boolean;
  tenantId: string;
  organizationName: string;
  productName?: string;
  logoDataUrl?: string | null;
  sectorTag: string;
  complianceProfile?: string;
  defaultRegion: string;
}

export interface UserAccount {
  id: string;
  email: string;
  full_name: string;
  role: string;
  email_verified: number;
  created_at_utc: string;
}

export interface TenantSettings {
  tenant_id: string;
  organization_name: string;
  product_name: string;
  logo_data_url: string | null;
  country_code: string;
  region: string;
  timezone: string;
  industry: string;
  compliance_profile: string;
  retention_days: number;
  thresholds_json: string;
  remediation_policy_json: string;
  updated_at_utc: string;
}

export interface SiteRecord {
  id: string;
  tenant_id: string;
  name: string;
  region: string;
  timezone: string;
  sector_tag: string;
  status: string;
  last_seen_utc: string | null;
  onlineCollectors?: number;
  activeIncidents?: number;
  dataSource?: 'live' | 'simulated' | 'none';
  healthState?: HealthState;
}

export interface OverviewResponse {
  totals: {
    totalServers: number;
    healthyServers: number;
    activeIncidents: number;
    onlineCollectors: number;
    totalCollectors: number;
    avgLatencyMs: number;
  };
  healthDistribution: Record<HealthState, number>;
  siteCards: SiteRecord[];
}

export interface MetricPoint {
  timestamp_utc: string;
  value: number | null;
  baseline: number | null;
  anomaly: boolean;
  source: string;
}

export interface MetricsResponse {
  metric: string;
  unit: string;
  source: 'live' | 'simulated' | 'none';
  isStale: boolean;
  lastUpdatedUtc: string | null;
  stats: {
    count: number;
    min: number | null;
    avg: number | null;
    max: number | null;
    p95: number | null;
  };
  points: MetricPoint[];
}

export interface VerifyMetricsResponse {
  metric: string;
  sample_count: number;
  first_timestamp_utc: string | null;
  last_timestamp_utc: string | null;
  raw_min: number | null;
  raw_avg: number | null;
  raw_max: number | null;
  raw_p95: number | null;
  gaps: Array<{ from_utc: string; to_utc: string; duration_sec: number }>;
}

export interface InfrastructureNode {
  source_id: string;
  site_id: string;
  site_name: string;
  region: string;
  cpu: number | null;
  ram: number | null;
  disk: number | null;
  latency: number | null;
  health_state: HealthState;
  health_reason?: string;
  source: 'live' | 'simulated';
  last_seen_utc: string;
}

export interface CollectorRecord {
  id: string;
  site_id: string;
  site_name: string;
  sector_tag: string;
  collector_code: string;
  region: string;
  collector_version: string;
  status: string;
  computed_status?: string;
  heartbeat_age_sec?: number;
  revoked?: number;
  key_version?: number;
  cpu_usage_pct: number;
  ram_usage_pct: number;
  local_policy_json: string;
  last_seen_utc: string | null;
}

export interface HealthHistoryRecord {
  id: number;
  tenant_id: string;
  site_id: string;
  source_id: string;
  previous_state: string | null;
  new_state: string;
  reason: string;
  source: 'live' | 'simulated';
  changed_at_utc: string;
}

export interface SlaMetricsResponse {
  collectionToDashboardP95Sec: number;
  p95TargetMet: boolean;
  breachToAlertTargetSec: number;
  heartbeatAgeSec: number;
  offlineDetectionTargetMet: boolean;
  outageBufferQueueDepth: number;
  sentPayloadCount: number;
  matchedReceivedCount: number;
  parityPercent: number;
}

export interface RawPreviewItem {
  id: number;
  captured_at_utc: string;
  raw_line: string;
  redacted_line: string;
  dropped_fields: string;
  source: string;
}

export interface EgressLogItem {
  id: number;
  payload_id: string;
  timestamp_utc: string;
  byte_size: number;
  destination: string;
  result: string;
  payload_json: string;
  matched_in_saas?: boolean;
}

export interface ReceiptItem {
  id: string;
  site_id: string;
  collector_id: string;
  payload_id: string;
  region: string;
  source: string;
  payload_sha256: string;
  prev_attestation_sha256: string | null;
  record_count: number;
  sent_at_utc: string;
  received_at_utc: string;
}

export interface IncidentRecord {
  id: string;
  site_id: string | null;
  parent_incident_id: string | null;
  is_cross_site_parent: number;
  affected_site_names: string;
  source_id: string;
  cause_signal: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'resolution_failed';
  decision_mode: 'AUTO_FIX' | 'ASK_APPROVAL' | 'NOTIFY_ONLY';
  decision_reasoning_json: string;
  merged_alert_count: number;
  correlation_explanation: string;
  manual_assignee?: string | null;
  manual_evidence?: string | null;
  source: 'live' | 'simulated';
  opened_at_utc: string;
  acknowledged_at_utc: string | null;
  resolved_at_utc: string | null;
}

export interface IncidentTimelineEvent {
  id: number;
  stage: string;
  actor: string;
  detail: string;
  timestamp_utc: string;
}

export interface RecommendationRecord {
  id: string;
  site_id: string;
  incident_id: string | null;
  category: string;
  title: string;
  action_id: string;
  target_alias: string;
  why_flagged: string;
  contributing_signals_json: string;
  confidence: number;
  reasoning_path_json: string;
  suggested_action: string;
  rollback_plan: string;
  risk_level: 'low' | 'medium' | 'high';
  projected_impact: string;
  status: string;
  source: 'live' | 'simulated';
  created_at_utc: string;
}

export interface JobRecord {
  id: string;
  site_id: string;
  action_id: string;
  target_alias: string;
  risk_level: string;
  status: string;
  rollback_performed?: number;
  summary: string | null;
  before_evidence_json: string | null;
  after_evidence_json: string | null;
  created_at_utc: string;
  completed_at_utc: string | null;
}

export interface AuditLogRecord {
  id: number;
  site_id: string | null;
  tier: string;
  actor: string;
  action: string;
  detail: string;
  source: string;
  prev_hash?: string | null;
  entry_hash?: string | null;
  timestamp_utc: string;
}

export interface EnvStatusItem {
  key: string;
  status: string;
  description: string;
}

export interface EnvStatusResponse {
  mode: string;
  requiresManualEnvVars: boolean;
  storageBackend?: string;
  items: EnvStatusItem[];
}
