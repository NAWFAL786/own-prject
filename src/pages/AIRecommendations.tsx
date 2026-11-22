import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { aurelisApi } from '../services/api';
import type { JobRecord, OperatorProfile, RecommendationRecord } from '../types/aurelis';

export function AIRecommendations({
  siteId,
  operator,
  refreshTick,
}: {
  siteId: string;
  operator: OperatorProfile;
  refreshTick: number;
}) {
  const [recs, setRecs] = useState<RecommendationRecord[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  const canApprove = ['owner', 'admin', 'tenant_admin'].includes(operator.role);

  const load = () => {
    aurelisApi
      .getRecommendations(siteId)
      .then((res) => {
        setRecs(res.recommendations);
        setJobs(res.jobs);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, [siteId, refreshTick]);

  const handleApprove = async (id: string) => {
    try {
      const res = await aurelisApi.approveRecommendation(id);
      setFeedback(
        `Dispatched signed job ${res.jobId} (${res.actionId}) to Tier 1 collector. Verification result updates automatically within ~5 seconds.`
      );
      load();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Approval rejected');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await aurelisApi.rejectRecommendation(id);
      load();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Dismissal failed');
    }
  };

  const handleRollback = async (jobId: string) => {
    try {
      await aurelisApi.rollbackJob(jobId);
      setFeedback(`Rolled back signed job ${jobId}; pre-execution snapshot restored and logged.`);
      load();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Rollback failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[#171717]">Explainable Remediation & Signed Job Channel</h2>
            <p className="mt-1 text-xs text-[#737373]">
              Every recommendation includes contributing signals, reasoning path, and rollback plan. Approving
              dispatches an HMAC-signed allow-listed job polled outbound by the Tier 1 collector.
            </p>
          </div>
          <span className="text-xs font-mono text-[#8D6B20]">
            Your Role: {operator.role} · {canApprove ? 'Approval Authorized' : 'Read-Only Viewer'}
          </span>
        </div>
        {feedback && (
          <div className="mt-3 p-3 rounded-lg bg-[#F5EBD2]/50 border border-[#C49A35]/40 text-xs text-[#171717]">
            {feedback}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {recs.map((r) => {
          const signals = JSON.parse(r.contributing_signals_json || '[]') as string[];
          const pathSteps = JSON.parse(r.reasoning_path_json || '[]') as string[];
          return (
            <div key={r.id} className="bg-white border border-[#E9E5DC] rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs text-[#737373]">
                    <span>{r.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-[#8D6B20]">Action: {r.action_id}</span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">Risk: {r.risk_level}</span>
                    <span aria-hidden="true">·</span>
                    <span className="uppercase">{r.source}</span>
                  </div>
                  <h3 className="mt-1 text-base font-semibold text-[#171717]">{r.title}</h3>
                </div>
                <div className="text-right font-mono text-xs tabular-nums">
                  <div className="text-[#8D6B20] font-semibold">{r.projected_impact}</div>
                  <div className="text-[#737373]">Confidence: {Math.round(r.confidence * 100)}%</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg p-4 space-y-2">
                  <div className="font-semibold text-[#171717]">Why Flagged & Signals</div>
                  <p className="text-[#737373]">{r.why_flagged}</p>
                  <div className="font-mono text-[11px] text-[#8D6B20]">{signals.join(' · ')}</div>
                </div>
                <div className="bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg p-4 space-y-2">
                  <div className="font-semibold text-[#171717]">Reasoning Path & Rollback Plan</div>
                  <ul className="space-y-1 text-[#737373]">
                    {pathSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                  <div className="text-[11px] text-[#171717] pt-1 border-t border-[#E9E5DC]">
                    <span className="font-semibold">Rollback:</span> {r.rollback_plan}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <span className="text-xs font-mono text-[#737373]">Status: {r.status}</span>
                {r.status === 'pending' && canApprove && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleReject(r.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#E9E5DC] text-xs font-medium text-[#737373] hover:text-[#171717]"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Dismiss</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApprove(r.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424]"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#C49A35]" />
                      <span>Approve & Dispatch Signed Job</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Signed Job Execution & Rollback History */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E9E5DC]">
          <h3 className="text-sm font-semibold text-[#171717]">Signed Remediation Job Verification & Rollback Log</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E9E5DC] bg-[#FAFAF7] text-xs font-semibold text-[#737373]">
                <th className="py-2.5 px-4">Job ID</th>
                <th className="py-2.5 px-4">Action ID</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Verification Summary</th>
                <th className="py-2.5 px-4">Timestamp UTC</th>
                <th className="py-2.5 px-4 text-right">Rollback</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9E5DC] text-xs">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[#737373]">
                    No signed remediation jobs dispatched yet. Approve a recommendation above to watch Tier 1 execute
                    and verify it live.
                  </td>
                </tr>
              ) : (
                jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="py-2.5 px-4 font-mono text-[#171717]">{j.id}</td>
                    <td className="py-2.5 px-4 font-mono text-[#8D6B20]">{j.action_id}</td>
                    <td className="py-2.5 px-4 font-semibold capitalize">{j.status.replace('_', ' ')}</td>
                    <td className="py-2.5 px-4 text-[#737373]">{j.summary || 'Queued for Tier 1 poll...'}</td>
                    <td className="py-2.5 px-4 font-mono text-[#737373] tabular-nums">
                      {j.completed_at_utc || j.created_at_utc}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {canApprove && j.status !== 'rolled_back' && j.status !== 'queued' && (
                        <button
                          type="button"
                          onClick={() => handleRollback(j.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#E9E5DC] hover:border-[#C49A35] text-xs font-medium text-[#171717]"
                        >
                          <RotateCcw className="w-3 h-3 text-[#C49A35]" />
                          <span>Rollback</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
