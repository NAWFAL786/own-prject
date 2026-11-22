import { useEffect, useState } from 'react';
import { WifiOff, Wifi, KeyRound, ShieldOff, ShieldCheck } from 'lucide-react';
import { aurelisApi } from '../services/api';
import type { CollectorRecord } from '../types/aurelis';

export function CollectorManagement({ siteId, refreshTick }: { siteId: string; refreshTick: number }) {
  const [collectors, setCollectors] = useState<CollectorRecord[]>([]);
  const [outageSimulated, setOutageSimulated] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const load = () => {
    aurelisApi
      .getCollectors(siteId)
      .then((res) => {
        setCollectors(res.collectors);
        setOutageSimulated(res.outageSimulated);
      })
      .catch(() => {});
    aurelisApi
      .getEgressLog()
      .then((res) => setQueueSize(res.queueSize))
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, [siteId, refreshTick]);

  const handleToggleOutage = async () => {
    const res = await aurelisApi.toggleOutage(!outageSimulated);
    setOutageSimulated(res.outageSimulated);
    setActionFeedback(
      res.outageSimulated
        ? 'Outage simulated: Tier 1 buffering approved payloads locally with exponential backoff.'
        : 'SaaS reconnected: Tier 1 flushing queued payloads with UUID idempotency.'
    );
    load();
  };

  const handleRotateKey = async (id: string) => {
    try {
      const res = await aurelisApi.rotateCollectorKey(id);
      setActionFeedback(`Rotated API key version for ${res.collectorId} to v${res.keyVersion}.`);
      load();
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : 'Failed to rotate collector key');
    }
  };

  const handleRevokeToggle = async (id: string) => {
    try {
      const res = await aurelisApi.revokeCollector(id);
      setActionFeedback(
        res.revoked
          ? `Revoked collector ${res.collectorId}; Tier 2 now rejects its batches with HTTP 403.`
          : `Reinstated collector ${res.collectorId} back into active ingest.`
      );
      load();
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : 'Failed to toggle revocation');
    }
  };

  const handlePolicyModeChange = async (id: string, mode: string) => {
    try {
      await aurelisApi.updateCollectorConfig(id, { mode });
      setActionFeedback(`Updated execution policy on ${id} to ${mode}.`);
      load();
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : 'Failed to update collector config');
    }
  };

  const handleKillSwitchToggle = async (id: string, nextVal: boolean) => {
    try {
      await aurelisApi.updateCollectorConfig(id, { kill_switch: nextVal });
      setActionFeedback(`Local kill switch on ${id} set to ${nextVal ? 'ENGAGED (safe stop)' : 'OFF'}.`);
      load();
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : 'Failed to toggle kill switch');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#171717]">Tier 1 Collector Fleet & SQLite Buffer Resilience</h2>
          <p className="mt-1 text-xs text-[#737373]">
            Collectors are bound 1-to-1 to a site, detect offline heartbeats within 60 seconds, and buffer payloads in
            local SQLite during SaaS outages.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right text-xs tabular-nums">
            <div className="text-[#737373]">Local Buffer Queue</div>
            <div className="font-mono font-semibold text-[#171717]">{queueSize} pending batches</div>
          </div>
          <button
            type="button"
            onClick={handleToggleOutage}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              outageSimulated ? 'bg-[#DC2626] text-white hover:bg-[#B91C1C]' : 'bg-[#171717] text-white hover:bg-[#242424]'
            }`}
          >
            {outageSimulated ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5 text-[#C49A35]" />}
            <span>{outageSimulated ? 'Reconnect SaaS & Flush Queue' : 'Simulate SaaS Outage'}</span>
          </button>
        </div>
      </div>

      {actionFeedback && (
        <div className="p-3 rounded-lg bg-[#F5EBD2]/50 border border-[#C49A35]/40 text-xs text-[#171717]">
          {actionFeedback}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {collectors.map((c) => {
          const policy = JSON.parse(c.local_policy_json || '{}') as { mode?: string; kill_switch?: boolean };
          const status = c.computed_status || c.status;
          const isRevoked = Boolean(c.revoked);
          return (
            <div key={c.id} className="bg-white border border-[#E9E5DC] rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-[#8D6B20] font-medium">{c.site_name}</div>
                  <h3 className="text-base font-semibold text-[#171717] font-mono mt-0.5">{c.collector_code}</h3>
                </div>
                <span
                  className={`text-xs font-semibold capitalize ${
                    status === 'online'
                      ? 'text-[#16A34A]'
                      : status === 'revoked' || status === 'offline'
                        ? 'text-[#DC2626]'
                        : 'text-[#D97706]'
                  }`}
                >
                  {status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg p-3 tabular-nums">
                <div>
                  <div className="text-[#737373]">Host CPU / RAM</div>
                  <div className="font-mono font-semibold text-[#171717] mt-0.5">
                    {c.cpu_usage_pct}% / {c.ram_usage_pct}%
                  </div>
                </div>
                <div>
                  <div className="text-[#737373]">Heartbeat Age</div>
                  <div className="font-mono font-semibold text-[#171717] mt-0.5">
                    {c.heartbeat_age_sec !== undefined ? `${c.heartbeat_age_sec}s` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[#737373]">Region</div>
                  <div className="font-mono text-[#171717] mt-0.5">{c.region}</div>
                </div>
                <div>
                  <div className="text-[#737373]">Key Version</div>
                  <div className="font-mono text-[#171717] mt-0.5">
                    v{c.key_version ?? 1} · v{c.collector_version}
                  </div>
                </div>
              </div>

              {/* Remote Policy & Kill Switch Controls */}
              <div className="space-y-2 text-xs pt-1 border-t border-[#E9E5DC]">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[#737373]" htmlFor={`mode-${c.id}`}>
                    Execution Mode
                  </label>
                  <select
                    id={`mode-${c.id}`}
                    value={policy.mode || 'approval_required'}
                    onChange={(e) => handlePolicyModeChange(c.id, e.target.value)}
                    className="px-2 py-1 rounded border border-[#E9E5DC] bg-white text-xs font-mono"
                  >
                    <option value="dry_run">dry_run</option>
                    <option value="approval_required">approval_required</option>
                    <option value="auto_approved">auto_approved</option>
                  </select>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#737373]">Local Kill Switch</span>
                  <button
                    type="button"
                    onClick={() => handleKillSwitchToggle(c.id, !policy.kill_switch)}
                    className={`px-2.5 py-1 rounded border text-[11px] font-mono font-semibold ${
                      policy.kill_switch
                        ? 'bg-[#DC2626] text-white border-[#DC2626]'
                        : 'bg-[#FAFAF7] text-[#171717] border-[#E9E5DC]'
                    }`}
                  >
                    {policy.kill_switch ? 'ENGAGED' : 'OFF'}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E9E5DC]">
                <button
                  type="button"
                  onClick={() => handleRotateKey(c.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E9E5DC] hover:border-[#C49A35] text-xs font-medium text-[#171717] whitespace-nowrap"
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#C49A35]" />
                  <span>Rotate Key</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRevokeToggle(c.id)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap ${
                    isRevoked
                      ? 'border-[#16A34A] text-[#16A34A]'
                      : 'border-[#E9E5DC] hover:border-[#DC2626] text-[#737373] hover:text-[#DC2626]'
                  }`}
                >
                  {isRevoked ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
                  <span>{isRevoked ? 'Reinstate' : 'Revoke'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
