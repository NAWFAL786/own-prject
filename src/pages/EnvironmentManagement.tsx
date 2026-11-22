import { useEffect, useState } from 'react';
import { Plus, KeyRound, CheckCircle2, Copy, Pencil, Trash2, Check, X } from 'lucide-react';
import { aurelisApi } from '../services/api';
import type { SiteRecord } from '../types/aurelis';

export function EnvironmentManagement({
  onSitesUpdated,
  refreshTick,
}: {
  onSitesUpdated: () => void;
  refreshTick: number;
}) {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [name, setName] = useState('');
  const [region, setRegion] = useState('ap-south-1');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [sectorTag, setSectorTag] = useState('it');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRegion, setEditRegion] = useState('ap-south-1');
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const [issuedToken, setIssuedToken] = useState<{ siteId: string; token: string; command: string; expires: string } | null>(
    null
  );
  const [enrollMessage, setEnrollMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadSites = () => {
    aurelisApi
      .getSites()
      .then((res) => setSites(res.sites))
      .catch(() => {});
  };

  useEffect(() => {
    loadSites();
  }, [refreshTick]);

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setActionMsg(null);
    try {
      await aurelisApi.createSite({ name: name.trim(), region, timezone, sector_tag: sectorTag });
      setName('');
      loadSites();
      onSitesUpdated();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Unable to create site');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (s: SiteRecord) => {
    setEditingId(s.id);
    setEditName(s.name);
    setEditRegion(s.region);
    setActionMsg(null);
  };

  const handleSaveEdit = async (id: string) => {
    try {
      await aurelisApi.updateSite(id, { name: editName, region: editRegion });
      setEditingId(null);
      loadSites();
      onSitesUpdated();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Unable to update site');
    }
  };

  const handleDeleteSite = async (id: string) => {
    setActionMsg(null);
    try {
      await aurelisApi.deleteSite(id);
      loadSites();
      onSitesUpdated();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Unable to delete site');
    }
  };

  const handleIssueToken = async (siteId: string) => {
    setEnrollMessage(null);
    const res = await aurelisApi.issueEnrollmentToken(siteId);
    setIssuedToken({ siteId, token: res.token, command: res.command, expires: res.expires_at_utc });
  };

  const handleTestEnroll = async () => {
    if (!issuedToken) return;
    try {
      const res = await aurelisApi.enrollCollectorWithToken(issuedToken.token);
      setEnrollMessage(`Site "${res.siteName}" connected with collector ${res.collectorId}. Single-use token consumed.`);
      loadSites();
      onSitesUpdated();
    } catch (err) {
      setEnrollMessage(err instanceof Error ? err.message : 'Enrollment check failed');
    }
  };

  const handleCopyCommand = () => {
    if (!issuedToken) return;
    navigator.clipboard?.writeText(issuedToken.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-6">
      {/* Add Site Onboarding Card */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-6">
        <h2 className="text-base font-semibold text-[#171717]">Add Multi-Site Location & Residency Boundary</h2>
        <p className="mt-1 text-xs text-[#737373]">
          Each site enforces strict regional residency and receives a single-use 24-hour collector enrollment token.
        </p>

        <form onSubmit={handleCreateSite} className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-[#171717] mb-1">Site Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Hyderabad DR Center"
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Data Residency</label>
            <select
              value={region}
              onChange={(e) => {
                setRegion(e.target.value);
                setTimezone(
                  e.target.value === 'ap-south-1'
                    ? 'Asia/Kolkata'
                    : e.target.value === 'eu-central-1'
                      ? 'Europe/Berlin'
                      : 'UTC'
                );
              }}
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs bg-white"
            >
              <option value="ap-south-1">ap-south-1 (India)</option>
              <option value="us-east-1">us-east-1 (US East)</option>
              <option value="us-west-2">us-west-2 (US West)</option>
              <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
              <option value="eu-west-1">eu-west-1 (Ireland)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Industry Template</label>
            <select
              value={sectorTag}
              onChange={(e) => setSectorTag(e.target.value)}
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
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424] whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5 text-[#C49A35]" />
            <span>Create Site</span>
          </button>
        </form>

        {actionMsg && (
          <div className="mt-3 p-2.5 rounded-lg bg-[#FEF2F2] border border-[#DC2626]/30 text-xs text-[#DC2626]">
            {actionMsg}
          </div>
        )}
      </div>

      {/* Issued Single-Use Token Banner */}
      {issuedToken && (
        <div className="bg-[#171717] text-white border border-[#C49A35]/50 rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-[#F5EBD2]">Single-Use Collector Enrollment Command</div>
            <span className="text-xs font-mono text-[#A3A3A3]">Expires: {issuedToken.expires}</span>
          </div>
          <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg p-3 flex items-center justify-between gap-3">
            <code className="text-xs font-mono text-[#F5EBD2] overflow-x-auto">{issuedToken.command}</code>
            <button
              type="button"
              onClick={handleCopyCommand}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#171717] text-xs text-white border border-[#3A3A3A] shrink-0"
            >
              <Copy className="w-3.5 h-3.5 text-[#C49A35]" />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleTestEnroll}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#C49A35] text-[#171717] text-xs font-semibold hover:bg-[#B68A27]"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Simulate Collector Enrollment & Verify Single-Use</span>
            </button>
            {enrollMessage && <span className="text-xs text-[#F5EBD2]">{enrollMessage}</span>}
          </div>
        </div>
      )}

      {/* Site Table */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E9E5DC] bg-[#FAFAF7] text-xs font-semibold text-[#737373]">
                <th className="py-3 px-4">Site Name</th>
                <th className="py-3 px-4">Residency Region</th>
                <th className="py-3 px-4">Industry Policy</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Last Heartbeat</th>
                <th className="py-3 px-4 text-right">Actions & Onboarding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9E5DC] text-xs">
              {sites.map((s) => (
                <tr key={s.id} className="hover:bg-[#FAFAF7]">
                  <td className="py-3 px-4 font-medium text-[#171717]">
                    {editingId === s.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="px-2 py-1 rounded border border-[#C49A35] text-xs w-full"
                      />
                    ) : (
                      s.name
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono">
                    {editingId === s.id ? (
                      <select
                        value={editRegion}
                        onChange={(e) => setEditRegion(e.target.value)}
                        className="px-2 py-1 rounded border border-[#C49A35] text-xs bg-white"
                      >
                        <option value="ap-south-1">ap-south-1</option>
                        <option value="us-east-1">us-east-1</option>
                        <option value="us-west-2">us-west-2</option>
                        <option value="eu-central-1">eu-central-1</option>
                        <option value="eu-west-1">eu-west-1</option>
                      </select>
                    ) : (
                      s.region
                    )}
                  </td>
                  <td className="py-3 px-4 uppercase text-[#8D6B20] font-medium">{s.sector_tag}</td>
                  <td className="py-3 px-4 capitalize font-medium">{s.status}</td>
                  <td className="py-3 px-4 font-mono text-[#737373] tabular-nums">
                    {s.last_seen_utc ? new Date(s.last_seen_utc).toLocaleTimeString() : 'Awaiting collector'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      {editingId === s.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(s.id)}
                            className="p-1.5 rounded border border-[#16A34A] text-[#16A34A]"
                            aria-label="Save site"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="p-1.5 rounded border border-[#E9E5DC] text-[#737373]"
                            aria-label="Cancel edit"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleIssueToken(s.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E9E5DC] hover:border-[#C49A35] text-xs font-medium text-[#171717] whitespace-nowrap"
                          >
                            <KeyRound className="w-3.5 h-3.5 text-[#C49A35]" />
                            <span>Issue Token</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(s)}
                            className="p-1.5 rounded-lg border border-[#E9E5DC] hover:border-[#C49A35] text-[#737373] hover:text-[#171717]"
                            aria-label={`Edit ${s.name}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {s.id !== 'site-blr-hq' && (
                            <button
                              type="button"
                              onClick={() => handleDeleteSite(s.id)}
                              className="p-1.5 rounded-lg border border-[#E9E5DC] hover:border-[#DC2626] text-[#737373] hover:text-[#DC2626]"
                              aria-label={`Delete ${s.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
