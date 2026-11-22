import { useEffect, useState } from 'react';
import { CheckCircle2, Plus, Upload, UserPlus, Save } from 'lucide-react';
import { aurelisApi } from '../services/api';
import type { EnvStatusResponse, OperatorProfile, SiteRecord, TenantSettings, UserAccount } from '../types/aurelis';

const ALLOW_LIST_FIELDS = [
  'metric_name',
  'metric_value',
  'unit',
  'timestamp_utc',
  'source_timezone',
  'source_id',
  'health_state',
  'event_category',
  'severity',
  'alert_context',
  'collector_id',
  'site_id',
  'tenant_id',
  'payload_id',
  'source',
  'connector',
  'collection_interval',
];

export function SettingsPage({
  operator,
  sites,
  onBrandingUpdated,
  refreshTick,
}: {
  operator: OperatorProfile;
  sites: SiteRecord[];
  onBrandingUpdated: () => void;
  refreshTick: number;
}) {
  const [envStatus, setEnvStatus] = useState<EnvStatusResponse | null>(null);
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [channels, setChannels] = useState<
    Array<{ id: string; site_id: string; site_name: string; channel_type: string; target_label: string; quiet_hours: string }>
  >([]);

  // Editable Tenant Settings
  const [orgName, setOrgName] = useState('');
  const [productName, setProductName] = useState('');
  const [industry, setIndustry] = useState('it');
  const [compliance, setCompliance] = useState('gdpr');
  const [retentionDays, setRetentionDays] = useState(7);
  const [cpuFair, setCpuFair] = useState(78);
  const [cpuPoor, setCpuPoor] = useState(90);
  const [latFair, setLatFair] = useState(60);
  const [remMode, setRemMode] = useState('approval_required');
  const [killSwitch, setKillSwitch] = useState(false);

  // User Invite
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('analyst');
  const [invitePass, setInvitePass] = useState('');

  // Notification Channel
  const [siteId, setSiteId] = useState(sites[0]?.id || 'site-blr-hq');
  const [channelType, setChannelType] = useState('slack');
  const [targetLabel, setTargetLabel] = useState('');

  // Email verification
  const [verifyCode, setVerifyCode] = useState('');

  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const isAdmin = ['owner', 'admin', 'tenant_admin'].includes(operator.role);

  const load = () => {
    aurelisApi.getEnvironmentStatus().then(setEnvStatus).catch(() => {});
    aurelisApi.getNotificationChannels().then((r) => setChannels(r.channels)).catch(() => {});
    aurelisApi.getUsers().then((r) => setUsers(r.users)).catch(() => {});
    aurelisApi
      .getSettings()
      .then((r) => {
        const s = r.settings;
        if (!s) return;
        setSettings(s);
        setOrgName(s.organization_name);
        setProductName(s.product_name);
        setIndustry(s.industry);
        setCompliance(s.compliance_profile);
        setRetentionDays(s.retention_days);
        const th = JSON.parse(s.thresholds_json || '{}') as Record<string, number>;
        if (th.cpu_fair) setCpuFair(th.cpu_fair);
        if (th.cpu_poor) setCpuPoor(th.cpu_poor);
        if (th.latency_fair_ms) setLatFair(th.latency_fair_ms);
        const rp = JSON.parse(s.remediation_policy_json || '{}') as { mode?: string; kill_switch?: boolean };
        if (rp.mode) setRemMode(rp.mode);
        setKillSwitch(Boolean(rp.kill_switch));
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, [refreshTick]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    try {
      await aurelisApi.updateSettings({
        organization_name: orgName,
        product_name: productName,
        industry,
        compliance_profile: compliance,
        retention_days: retentionDays,
        region: settings?.region || operator.defaultRegion,
        thresholds_json: {
          cpu_fair: Number(cpuFair),
          cpu_poor: Number(cpuPoor),
          latency_fair_ms: Number(latFair),
          latency_poor_ms: 120,
          packet_loss_fair: 1.5,
        },
        remediation_policy_json: {
          dry_run: remMode === 'dry_run',
          mode: remMode,
          kill_switch: killSwitch,
          allowed_actions: ['flush_dns_cache', 'rotate_logs', 'clear_temp_files', 'restart_service', 'escalate_to_human'],
        },
      });
      setStatusMsg('Organization branding, compliance profile, thresholds, and policy saved.');
      onBrandingUpdated();
      load();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 250 * 1024) {
      setStatusMsg('Logo file must be under 250 KB (PNG or SVG).');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      try {
        await aurelisApi.uploadLogo(dataUrl);
        setStatusMsg('Organization logo validated and applied across header, sidebar, and landing view.');
        onBrandingUpdated();
        load();
      } catch (err) {
        setStatusMsg(err instanceof Error ? err.message : 'Rejected logo upload');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    try {
      await aurelisApi.inviteUser({
        fullName: inviteName,
        email: inviteEmail,
        role: inviteRole,
        temporaryPassword: invitePass,
      });
      setInviteName('');
      setInviteEmail('');
      setInvitePass('');
      setStatusMsg(`Added user ${inviteEmail} (${inviteRole}) to tenant.`);
      load();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Unable to add user');
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await aurelisApi.verifyEmail(verifyCode);
      setStatusMsg('Operator email verified cleanly.');
      setVerifyCode('');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Email verification failed');
    }
  };

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetLabel.trim()) return;
    await aurelisApi.createNotificationChannel({
      site_id: siteId,
      channel_type: channelType,
      target_label: targetLabel.trim(),
      quiet_hours: '23:00-06:00',
    });
    setTargetLabel('');
    load();
  };

  return (
    <div className="space-y-6">
      {statusMsg && (
        <div className="p-3.5 rounded-lg bg-[#F5EBD2]/50 border border-[#C49A35]/40 text-xs text-[#171717]">
          {statusMsg}
        </div>
      )}

      {/* Email Verification Prompt if unverified */}
      {operator.emailVerified === false && (
        <div className="bg-white border border-[#C49A35] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[#171717]">Verify Your Operator Email ({operator.email})</h3>
            <p className="text-xs text-[#737373]">
              Paste the <code className="font-mono">aur_vrf_...</code> code from MailHog (:8025) or registration preview.
            </p>
          </div>
          <form onSubmit={handleVerifyEmail} className="flex items-center gap-2">
            <input
              type="text"
              required
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              placeholder="aur_vrf_..."
              className="px-3 py-1.5 rounded-lg border border-[#E9E5DC] text-xs font-mono"
            />
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg bg-[#171717] text-white text-xs font-medium whitespace-nowrap"
            >
              Verify Email
            </button>
          </form>
        </div>
      )}

      {/* Organization Branding, Logo Upload, Compliance & Thresholds */}
      <form onSubmit={handleSaveSettings} className="bg-white border border-[#E9E5DC] rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[#171717]">
              Organization Branding, Compliance Profile & AIOps Policy
            </h2>
            <p className="text-xs text-[#737373] mt-0.5">
              Customize workspace branding, PNG/SVG logo, local redaction profile, retention window, and thresholds.
            </p>
          </div>
          {isAdmin && (
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424] whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5 text-[#C49A35]" />
              <span>Save Organization Settings</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Organization Name</label>
            <input
              type="text"
              disabled={!isAdmin}
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Console Brand Title</label>
            <input
              type="text"
              disabled={!isAdmin}
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Industry Sector</label>
            <select
              disabled={!isAdmin}
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs bg-white"
            >
              <option value="it">IT / Cloud</option>
              <option value="banking">Banking</option>
              <option value="healthcare">Healthcare</option>
              <option value="retail">Retail</option>
              <option value="manufacturing">Manufacturing</option>
              <option value="telecom">Telecom</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Compliance Profile</label>
            <select
              disabled={!isAdmin}
              value={compliance}
              onChange={(e) => setCompliance(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs bg-white"
            >
              <option value="gdpr">GDPR (7d raw retention)</option>
              <option value="pci_dss">PCI-DSS (Card PAN scrub)</option>
              <option value="hipaa">HIPAA (Health/MRN scrub)</option>
              <option value="rbi">RBI Residency</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Raw Retention Days (Tier 1)</label>
            <input
              type="number"
              min={1}
              max={365}
              disabled={!isAdmin}
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">CPU Fair / Poor (%)</label>
            <div className="flex gap-2">
              <input
                type="number"
                disabled={!isAdmin}
                value={cpuFair}
                onChange={(e) => setCpuFair(Number(e.target.value))}
                className="w-1/2 px-2 py-2 rounded-lg border border-[#E9E5DC] text-xs font-mono"
              />
              <input
                type="number"
                disabled={!isAdmin}
                value={cpuPoor}
                onChange={(e) => setCpuPoor(Number(e.target.value))}
                className="w-1/2 px-2 py-2 rounded-lg border border-[#E9E5DC] text-xs font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Latency Fair Threshold (ms)</label>
            <input
              type="number"
              disabled={!isAdmin}
              value={latFair}
              onChange={(e) => setLatFair(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Remediation Mode</label>
            <select
              disabled={!isAdmin}
              value={remMode}
              onChange={(e) => setRemMode(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs bg-white"
            >
              <option value="approval_required">approval_required</option>
              <option value="dry_run">dry_run</option>
              <option value="auto_approved">auto_approved</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-[#E9E5DC]">
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#E9E5DC] hover:border-[#C49A35] text-xs font-medium text-[#171717] cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-[#C49A35]" />
              <span>Upload PNG / SVG Logo</span>
              <input type="file" accept=".png,.svg,image/png,image/svg+xml" className="hidden" onChange={handleLogoUpload} disabled={!isAdmin} />
            </label>
            <span className="text-[11px] text-[#737373]">Sanitized server-side; active SVG scripts blocked.</span>
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-medium text-[#171717]">
            <input
              type="checkbox"
              disabled={!isAdmin}
              checked={killSwitch}
              onChange={(e) => setKillSwitch(e.target.checked)}
              className="rounded border-[#E9E5DC]"
            />
            <span>Tenant-Wide Remediation Kill Switch</span>
          </label>
        </div>
      </form>

      {/* Allow-List Fields Viewer */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-6">
        <h3 className="text-sm font-semibold text-[#171717]">Strict Tier 1 -&gt; Tier 2 Metadata Allow-List Schema</h3>
        <p className="text-xs text-[#737373] mt-1">
          Only the 17 allow-listed keys below can traverse Tier 1 to Tier 2. Any unapproved field is dropped locally
          and rejected with HTTP 400 by Pydantic/Express validation.
        </p>
        <div className="mt-3 p-3 rounded-lg bg-[#FAFAF7] border border-[#E9E5DC] font-mono text-xs text-[#8D6B20] leading-relaxed">
          {ALLOW_LIST_FIELDS.join(' · ')}
        </div>
      </div>

      {/* Users & Roles (RBAC) */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-[#171717]">Tenant Users & Role-Based Access Control (RBAC)</h3>
          <p className="text-xs text-[#737373] mt-0.5">
            Only Owner/Admin roles can rotate collector keys, edit settings, or approve remediation jobs.
          </p>
        </div>

        {isAdmin && (
          <form onSubmit={handleInviteUser} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">Full Name</label>
              <input
                type="text"
                required
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Arjun Rao"
                className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">Email</label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="arjun@aurelis-ops.io"
                className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs bg-white"
              >
                <option value="admin">Admin</option>
                <option value="analyst">Analyst</option>
                <option value="viewer">Viewer (Read-Only)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">Temp Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={invitePass}
                onChange={(e) => setInvitePass(e.target.value)}
                placeholder="Min 8 chars"
                className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424] whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5 text-[#C49A35]" />
              <span>Add User</span>
            </button>
          </form>
        )}

        <div className="border border-[#E9E5DC] rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAFAF7] border-b border-[#E9E5DC] text-[#737373]">
                <th className="py-2.5 px-4">Operator</th>
                <th className="py-2.5 px-4">Email</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4">Verified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9E5DC]">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2.5 px-4 font-medium text-[#171717]">{u.full_name}</td>
                  <td className="py-2.5 px-4 font-mono">{u.email}</td>
                  <td className="py-2.5 px-4 capitalize text-[#8D6B20] font-semibold">{u.role}</td>
                  <td className="py-2.5 px-4">{u.email_verified ? 'Verified' : 'Pending'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Zero-Config Environment & Deployment Checklist */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-6">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-[#16A34A]" />
          <h2 className="text-base font-semibold text-[#171717]">
            Zero-Config Runtime & Production Deployment Checklist
          </h2>
        </div>
        <p className="mt-1 text-xs text-[#737373]">
          Active mode: <span className="font-mono font-semibold text-[#171717]">{envStatus?.storageBackend || 'embedded-sqlite'}</span>. For production multi-region deployment, replace placeholder URLs below via environment variables without touching code.
        </p>

        <div className="mt-4 divide-y divide-[#E9E5DC] border border-[#E9E5DC] rounded-lg overflow-hidden">
          {(envStatus?.items || []).map((item) => (
            <div key={item.key} className="p-3.5 bg-white flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-mono font-semibold text-[#171717]">{item.key}</div>
                <div className="text-xs text-[#737373] mt-0.5">{item.description}</div>
              </div>
              <span className="text-xs font-mono font-semibold text-[#16A34A] uppercase">{item.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Metadata-Only Notification Channels */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-6">
        <h3 className="text-base font-semibold text-[#171717]">Site Notification Channels (Metadata-Only)</h3>
        <p className="mt-1 text-xs text-[#737373]">
          Notifications transmit only incident title, site name, severity, and suggested action—never raw logs.
        </p>

        <form onSubmit={handleAddChannel} className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Site</label>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs bg-white"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Channel</label>
            <select
              value={channelType}
              onChange={(e) => setChannelType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs bg-white"
            >
              <option value="slack">Slack</option>
              <option value="teams">Microsoft Teams</option>
              <option value="email">SMTP Email (MailHog)</option>
              <option value="webhook">Webhook</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Target Label</label>
            <input
              type="text"
              required
              value={targetLabel}
              onChange={(e) => setTargetLabel(e.target.value)}
              placeholder="#sre-oncall"
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424] whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5 text-[#C49A35]" />
            <span>Add Channel</span>
          </button>
        </form>

        <div className="mt-4 divide-y divide-[#E9E5DC] border border-[#E9E5DC] rounded-lg">
          {channels.map((ch) => (
            <div key={ch.id} className="p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                <span className="font-semibold text-[#171717]">{ch.target_label}</span>
                <span className="mx-2 text-[#737373]">·</span>
                <span className="text-[#737373]">{ch.site_name}</span>
              </div>
              <div className="font-mono text-[#8D6B20] uppercase">{ch.channel_type}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
