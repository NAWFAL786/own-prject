import { useEffect, useState } from 'react';
import { Check, Clock, Activity } from 'lucide-react';
import { aurelisApi } from '../services/api';
import type { DataSourceMode, HealthHistoryRecord, IncidentRecord, IncidentTimelineEvent } from '../types/aurelis';
import { HealthStatusText, SeverityText } from '../components/common/HealthStatusText';

export function IncidentManagement({
  siteId,
  dataSource,
  refreshTick,
}: {
  siteId: string;
  dataSource: DataSourceMode;
  refreshTick: number;
}) {
  const [viewTab, setViewTab] = useState<'incidents' | 'health_history'>('incidents');
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [healthHistory, setHealthHistory] = useState<HealthHistoryRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'acknowledged' | 'resolved'>('all');
  const [selectedIncident, setSelectedIncident] = useState<IncidentRecord | null>(null);
  const [timeline, setTimeline] = useState<IncidentTimelineEvent[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [evidenceInput, setEvidenceInput] = useState('');

  const load = () => {
    aurelisApi
      .getIncidents(siteId, dataSource)
      .then((res) => setIncidents(res.incidents))
      .catch(() => {});
    aurelisApi
      .getHealthHistory(siteId)
      .then((res) => setHealthHistory(res.history))
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, [siteId, dataSource, refreshTick]);

  const handleViewTimeline = async (inc: IncidentRecord) => {
    setSelectedIncident(inc);
    const res = await aurelisApi.getIncidentTimeline(inc.id);
    setTimeline(res.events);
  };

  const handleAcknowledge = async (id: string) => {
    await aurelisApi.acknowledgeIncident(id);
    load();
    if (selectedIncident?.id === id) {
      const res = await aurelisApi.getIncidentTimeline(id);
      setTimeline(res.events);
    }
  };

  const handleResolveSubmit = async (id: string) => {
    await aurelisApi.resolveIncident(id, evidenceInput.trim() || undefined);
    setResolvingId(null);
    setEvidenceInput('');
    load();
    if (selectedIncident?.id === id) {
      const res = await aurelisApi.getIncidentTimeline(id);
      setTimeline(res.events);
    }
  };

  const filtered = incidents.filter((i) => (statusFilter === 'all' ? true : i.status === statusFilter));

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#171717]">Correlated Incidents & Health Transitions</h2>
          <p className="text-xs text-[#737373] mt-0.5">
            Parent/child cross-site correlation, Fix-or-Notify reasoning, manual verification evidence, and health state transitions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg">
            <button
              type="button"
              onClick={() => setViewTab('incidents')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewTab === 'incidents' ? 'bg-[#171717] text-white' : 'text-[#737373] hover:text-[#171717]'
              }`}
            >
              Incidents ({incidents.length})
            </button>
            <button
              type="button"
              onClick={() => setViewTab('health_history')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewTab === 'health_history' ? 'bg-[#171717] text-white' : 'text-[#737373] hover:text-[#171717]'
              }`}
            >
              Health History ({healthHistory.length})
            </button>
          </div>

          {viewTab === 'incidents' && (
            <div className="flex items-center gap-1 p-1 bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg">
              {(['all', 'open', 'acknowledged', 'resolved'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap ${
                    statusFilter === st ? 'bg-[#171717] text-white' : 'text-[#737373] hover:text-[#171717]'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewTab === 'health_history' ? (
        <div className="bg-white border border-[#E9E5DC] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E9E5DC] flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#C49A35]" />
            <h3 className="text-sm font-semibold text-[#171717]">Source Health State Transition Log</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E9E5DC] bg-[#FAFAF7] text-xs font-semibold text-[#737373]">
                  <th className="py-3 px-4">Changed UTC</th>
                  <th className="py-3 px-4">Source ID</th>
                  <th className="py-3 px-4">Previous</th>
                  <th className="py-3 px-4">New State</th>
                  <th className="py-3 px-4">Source Type</th>
                  <th className="py-3 px-4">Transition Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9E5DC] text-xs">
                {healthHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#737373]">
                      No health state transitions logged for this site scope.
                    </td>
                  </tr>
                ) : (
                  healthHistory.map((h) => (
                    <tr key={h.id}>
                      <td className="py-3 px-4 font-mono text-[#737373] tabular-nums whitespace-nowrap">
                        {h.changed_at_utc}
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-[#171717]">{h.source_id}</td>
                      <td className="py-3 px-4 text-[#737373]">{h.previous_state || 'Initial'}</td>
                      <td className="py-3 px-4">
                        <HealthStatusText state={(h.new_state as 'Excellent' | 'Good' | 'Fair' | 'Poor') || 'Good'} />
                      </td>
                      <td className="py-3 px-4 uppercase text-[#8D6B20] font-semibold">{h.source}</td>
                      <td className="py-3 px-4 text-[#171717]">{h.reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            {filtered.length === 0 ? (
              <div className="bg-white border border-[#E9E5DC] rounded-xl p-8 text-center text-xs text-[#737373]">
                No {dataSource === 'all' ? '' : `${dataSource} `}incidents match the active filter.
              </div>
            ) : (
              filtered.map((inc) => {
                const sites = JSON.parse(inc.affected_site_names || '[]') as string[];
                const reasoning = JSON.parse(inc.decision_reasoning_json || '{}') as {
                  cause?: string;
                  confidence?: number;
                  outcome?: string;
                };
                return (
                  <div
                    key={inc.id}
                    className={`bg-white border rounded-xl p-5 space-y-3 ${
                      selectedIncident?.id === inc.id ? 'border-[#C49A35]' : 'border-[#E9E5DC]'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#737373] mb-1">
                          <SeverityText severity={inc.severity} />
                          <span aria-hidden="true">·</span>
                          <span className="font-mono font-semibold text-[#8D6B20]">{inc.decision_mode}</span>
                          <span aria-hidden="true">·</span>
                          <span>{inc.is_cross_site_parent ? 'Cross-Site Parent' : 'Site Incident'}</span>
                          <span aria-hidden="true">·</span>
                          <span className={inc.source === 'live' ? 'uppercase font-semibold text-[#16A34A]' : 'uppercase'}>
                            {inc.source}
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold text-[#171717]">{inc.title}</h3>
                      </div>
                      <span className="text-xs font-medium capitalize text-[#171717]">{inc.status.replace('_', ' ')}</span>
                    </div>

                    <p className="text-xs text-[#737373]">{inc.correlation_explanation}</p>

                    <div className="bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg p-3 text-xs space-y-1">
                      <div>
                        <span className="font-semibold text-[#171717]">Affected Sites:</span>{' '}
                        {sites.join(', ') || 'Single Site'}
                      </div>
                      {reasoning.cause && (
                        <div>
                          <span className="font-semibold text-[#171717]">Diagnosis:</span> {reasoning.cause} (Confidence{' '}
                          {Math.round((reasoning.confidence || 0) * 100)}%)
                        </div>
                      )}
                      {reasoning.outcome && (
                        <div className="text-[#8D6B20]">
                          <span className="font-semibold">Decision:</span> {reasoning.outcome}
                        </div>
                      )}
                      {inc.manual_evidence && (
                        <div className="text-[#16A34A]">
                          <span className="font-semibold">Operator Verification:</span> {inc.manual_evidence} (
                          {inc.manual_assignee})
                        </div>
                      )}
                    </div>

                    {resolvingId === inc.id && (
                      <div className="p-3 bg-[#FAFAF7] border border-[#C49A35]/50 rounded-lg space-y-2">
                        <label className="block text-xs font-medium text-[#171717]">
                          Manual Verification Evidence Note
                        </label>
                        <input
                          type="text"
                          value={evidenceInput}
                          onChange={(e) => setEvidenceInput(e.target.value)}
                          placeholder="e.g., Confirmed RTT back to 18ms via local ping check"
                          className="w-full px-3 py-1.5 rounded border border-[#E9E5DC] bg-white text-xs"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleResolveSubmit(inc.id)}
                            className="px-3 py-1.5 rounded bg-[#16A34A] text-white text-xs font-medium"
                          >
                            Confirm Resolution
                          </button>
                          <button
                            type="button"
                            onClick={() => setResolvingId(null)}
                            className="px-3 py-1.5 rounded border border-[#E9E5DC] text-xs text-[#737373]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleViewTimeline(inc)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E9E5DC] text-xs font-medium text-[#171717] hover:border-[#C49A35]"
                      >
                        <Clock className="w-3.5 h-3.5 text-[#C49A35]" />
                        <span>Timeline</span>
                      </button>
                      {inc.status === 'open' && (
                        <button
                          type="button"
                          onClick={() => handleAcknowledge(inc.id)}
                          className="px-3 py-1.5 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424]"
                        >
                          Acknowledge
                        </button>
                      )}
                      {inc.status !== 'resolved' && resolvingId !== inc.id && (
                        <button
                          type="button"
                          onClick={() => setResolvingId(inc.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#E9E5DC] text-xs font-medium text-[#16A34A] hover:border-[#16A34A]"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Resolve with Evidence</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="lg:col-span-5 bg-white border border-[#E9E5DC] rounded-xl p-6 h-fit">
            <h3 className="text-sm font-semibold text-[#171717]">Incident Lifecycle Timeline</h3>
            {!selectedIncident ? (
              <p className="mt-3 text-xs text-[#737373]">
                Select Timeline on any incident to inspect detection, diagnosis, decision, approval, and verification steps.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="text-xs font-medium text-[#8D6B20]">{selectedIncident.title}</div>
                {timeline.length === 0 ? (
                  <div className="text-xs text-[#737373]">No timeline events recorded yet.</div>
                ) : (
                  <div className="space-y-3 border-t border-[#E9E5DC] pt-3">
                    {timeline.map((ev) => (
                      <div key={ev.id} className="text-xs space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold uppercase text-[#171717]">{ev.stage}</span>
                          <span className="font-mono text-[11px] text-[#737373] tabular-nums">
                            {new Date(ev.timestamp_utc).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="text-[#737373]">{ev.detail}</div>
                        <div className="text-[11px] font-mono text-[#8D6B20]">Actor: {ev.actor}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
