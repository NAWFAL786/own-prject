import type {
  AuditLogRecord,
  CollectorRecord,
  DataSourceMode,
  EgressLogItem,
  EnvStatusResponse,
  HealthHistoryRecord,
  IncidentRecord,
  IncidentTimelineEvent,
  InfrastructureNode,
  JobRecord,
  MetricsResponse,
  OperatorProfile,
  OverviewResponse,
  PublicBranding,
  RawPreviewItem,
  ReceiptItem,
  RecommendationRecord,
  SiteRecord,
  SlaMetricsResponse,
  TenantSettings,
  UserAccount,
  VerifyMetricsResponse,
} from '../types/aurelis';

// Optional external overrides (zero-config defaults to same-origin Express routes)
const SAAS_BASE = (import.meta.env.VITE_SAAS_API_URL as string | undefined)?.replace(/\/$/, '') || '';
const COLLECTOR_BASE = (import.meta.env.VITE_COLLECTOR_API_URL as string | undefined)?.replace(/\/$/, '') || '';

// Token kept strictly in JS memory (never localStorage/sessionStorage)
let sessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function getSessionToken(): string | null {
  return sessionToken;
}

async function request<T>(base: string, path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }
  const resp = await fetch(`${base}${path}`, { ...options, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || `Request failed (${resp.status})`);
  }
  return data as T;
}

export const aurelisApi = {
  getPublicBranding: () => request<PublicBranding>(SAAS_BASE, '/api/branding/public'),
  getEnvironmentStatus: () => request<EnvStatusResponse>(SAAS_BASE, '/api/environment/status'),
  getAuthStatus: () => request<{ hasOperators: boolean }>(SAAS_BASE, '/api/auth/status'),
  login: (email: string, password: string) =>
    request<{ token: string; operator: OperatorProfile }>(SAAS_BASE, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (payload: {
    email: string;
    password: string;
    fullName: string;
    mode: 'join_workspace' | 'new_tenant';
    organizationName?: string;
    countryCode?: string;
    region?: string;
    timezone?: string;
    sectorTag?: string;
    complianceProfile?: string;
  }) =>
    request<{ token: string; emailVerificationNotice?: string; operator: OperatorProfile }>(
      SAAS_BASE,
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  logout: () => request<{ status: string }>(SAAS_BASE, '/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }),
  forgotPassword: (email: string) =>
    request<{ message: string; previewResetCode?: string }>(SAAS_BASE, '/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (code: string, newPassword: string) =>
    request<{ status: string }>(SAAS_BASE, '/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ code, newPassword }),
    }),
  verifyEmail: (code: string) =>
    request<{ verified: boolean }>(SAAS_BASE, '/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  getUsers: () => request<{ users: UserAccount[] }>(SAAS_BASE, '/api/users'),
  inviteUser: (payload: { email: string; fullName: string; role: string; temporaryPassword: string }) =>
    request<{ id: string }>(SAAS_BASE, '/api/users/invite', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getSettings: () => request<{ settings: TenantSettings }>(SAAS_BASE, '/v1/settings'),
  updateSettings: (payload: {
    organization_name?: string;
    product_name?: string;
    country_code?: string;
    region?: string;
    timezone?: string;
    industry?: string;
    compliance_profile?: string;
    retention_days?: number;
    thresholds_json?: Record<string, unknown>;
    remediation_policy_json?: Record<string, unknown>;
  }) =>
    request<{ settings: TenantSettings }>(SAAS_BASE, '/v1/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  uploadLogo: (dataUrl: string) =>
    request<{ logoDataUrl: string }>(SAAS_BASE, '/v1/settings/logo', {
      method: 'POST',
      body: JSON.stringify({ dataUrl }),
    }),

  getOverview: (siteId: string, source: DataSourceMode = 'all') =>
    request<OverviewResponse>(
      SAAS_BASE,
      `/v1/overview?site_id=${encodeURIComponent(siteId)}&source=${encodeURIComponent(source)}`
    ),
  getMetrics: (type: string, siteId: string, range: string, source: DataSourceMode = 'all') =>
    request<MetricsResponse>(
      SAAS_BASE,
      `/v1/metrics?type=${encodeURIComponent(type)}&site_id=${encodeURIComponent(siteId)}&range=${encodeURIComponent(range)}&source=${encodeURIComponent(source)}`
    ),
  verifyMetrics: (type: string, siteId: string) =>
    request<VerifyMetricsResponse>(
      SAAS_BASE,
      `/v1/metrics/verify?type=${encodeURIComponent(type)}&site_id=${encodeURIComponent(siteId)}`
    ),
  getInfrastructure: (siteId: string, source: DataSourceMode = 'all') =>
    request<{ nodes: InfrastructureNode[] }>(
      SAAS_BASE,
      `/v1/infrastructure?site_id=${encodeURIComponent(siteId)}&source=${encodeURIComponent(source)}`
    ),
  getHealthHistory: (siteId: string) =>
    request<{ history: HealthHistoryRecord[] }>(
      SAAS_BASE,
      `/v1/health-history?site_id=${encodeURIComponent(siteId)}`
    ),
  getSlaMetrics: () => request<SlaMetricsResponse>(SAAS_BASE, '/v1/sla-metrics'),

  getSites: () => request<{ sites: SiteRecord[] }>(SAAS_BASE, '/v1/sites'),
  createSite: (payload: { name: string; region: string; timezone: string; sector_tag: string }) =>
    request<{ site: SiteRecord }>(SAAS_BASE, '/v1/sites', { method: 'POST', body: JSON.stringify(payload) }),
  updateSite: (id: string, payload: { name?: string; region?: string; timezone?: string; sector_tag?: string }) =>
    request<{ site: SiteRecord }>(SAAS_BASE, `/v1/sites/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteSite: (id: string) =>
    request<{ deleted: boolean }>(SAAS_BASE, `/v1/sites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  issueEnrollmentToken: (siteId: string) =>
    request<{ token: string; expires_at_utc: string; command: string }>(
      SAAS_BASE,
      `/v1/sites/${encodeURIComponent(siteId)}/enrollment-tokens`,
      { method: 'POST', body: JSON.stringify({}) }
    ),
  enrollCollectorWithToken: (token: string) =>
    request<{ status: string; collectorId: string; siteId: string; siteName: string }>(
      SAAS_BASE,
      '/v1/collector/enroll',
      { method: 'POST', body: JSON.stringify({ token }) }
    ),

  getCollectors: (siteId: string) =>
    request<{ collectors: CollectorRecord[]; outageSimulated: boolean }>(
      SAAS_BASE,
      `/v1/collectors?site_id=${encodeURIComponent(siteId)}`
    ),
  rotateCollectorKey: (collectorId: string) =>
    request<{ collectorId: string; keyVersion: number }>(
      SAAS_BASE,
      `/v1/collectors/${encodeURIComponent(collectorId)}/rotate-key`,
      { method: 'POST', body: JSON.stringify({}) }
    ),
  revokeCollector: (collectorId: string) =>
    request<{ collectorId: string; revoked: boolean }>(
      SAAS_BASE,
      `/v1/collectors/${encodeURIComponent(collectorId)}/revoke`,
      { method: 'POST', body: JSON.stringify({}) }
    ),
  updateCollectorConfig: (collectorId: string, payload: { mode?: string; kill_switch?: boolean }) =>
    request<{ policy: Record<string, unknown> }>(
      SAAS_BASE,
      `/v1/collectors/${encodeURIComponent(collectorId)}/config`,
      { method: 'PUT', body: JSON.stringify(payload) }
    ),
  toggleOutage: (enabled: boolean) =>
    request<{ outageSimulated: boolean }>(COLLECTOR_BASE, '/v1/collector/simulate/outage', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  getRawPreview: () => request<{ previews: RawPreviewItem[] }>(COLLECTOR_BASE, '/v1/collector/raw-preview'),
  getEgressLog: () =>
    request<{ egressLogs: EgressLogItem[]; queueSize: number; oldestQueuedUtc: string | null }>(
      COLLECTOR_BASE,
      '/v1/collector/egress-log'
    ),
  getReceivedReceipts: () => request<{ receipts: ReceiptItem[] }>(SAAS_BASE, '/v1/privacy/received'),
  injectPrivacyTest: (rawLogLine: string, extraFieldTest: string) =>
    request<{
      raw: string;
      redacted: string;
      droppedFields: string[];
      tier2RejectionTest: { rejected: boolean; reason: string } | null;
    }>(COLLECTOR_BASE, '/v1/collector/simulate/inject', {
      method: 'POST',
      body: JSON.stringify({ rawLogLine, extraFieldTest }),
    }),

  runScenario: (scenario: string) =>
    request<{ status: string; detail: string }>(SAAS_BASE, '/v1/scenarios/run', {
      method: 'POST',
      body: JSON.stringify({ scenario }),
    }),

  getIncidents: (siteId: string, source: DataSourceMode = 'all') =>
    request<{ incidents: IncidentRecord[] }>(
      SAAS_BASE,
      `/v1/incidents?site_id=${encodeURIComponent(siteId)}&source=${encodeURIComponent(source)}`
    ),
  getIncidentTimeline: (id: string) =>
    request<{ events: IncidentTimelineEvent[] }>(SAAS_BASE, `/v1/incidents/${encodeURIComponent(id)}/timeline`),
  acknowledgeIncident: (id: string) =>
    request<{ status: string }>(SAAS_BASE, `/v1/incidents/${encodeURIComponent(id)}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  resolveIncident: (id: string, manualEvidence?: string) =>
    request<{ status: string }>(SAAS_BASE, `/v1/incidents/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ manualEvidence }),
    }),

  getRecommendations: (siteId: string) =>
    request<{ recommendations: RecommendationRecord[]; jobs: JobRecord[] }>(
      SAAS_BASE,
      `/v1/recommendations?site_id=${encodeURIComponent(siteId)}`
    ),
  approveRecommendation: (id: string) =>
    request<{ status: string; jobId: string; actionId: string }>(
      SAAS_BASE,
      `/v1/recommendations/${encodeURIComponent(id)}/approve`,
      { method: 'POST', body: JSON.stringify({}) }
    ),
  rejectRecommendation: (id: string) =>
    request<{ status: string }>(SAAS_BASE, `/v1/recommendations/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  rollbackJob: (jobId: string) =>
    request<{ status: string }>(SAAS_BASE, `/v1/jobs/${encodeURIComponent(jobId)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getAuditLogs: (siteId: string) =>
    request<{ logs: AuditLogRecord[]; chainVerified: boolean; totalEntries: number }>(
      SAAS_BASE,
      `/v1/audit-logs?site_id=${encodeURIComponent(siteId)}`
    ),
  getNotificationChannels: () =>
    request<{
      channels: Array<{
        id: string;
        site_id: string;
        site_name: string;
        channel_type: string;
        target_label: string;
        quiet_hours: string;
        enabled: number;
      }>;
    }>(SAAS_BASE, '/v1/notifications/channels'),
  createNotificationChannel: (payload: { site_id: string; channel_type: string; target_label: string; quiet_hours: string }) =>
    request<{ id: string }>(SAAS_BASE, '/v1/notifications/channels', { method: 'POST', body: JSON.stringify(payload) }),
};
