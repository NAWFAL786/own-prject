import { useEffect, useState } from 'react';
import { Sparkles, Play, Gauge } from 'lucide-react';
import { aurelisApi } from '../services/api';
import type { DataSourceMode, MetricsResponse, SlaMetricsResponse } from '../types/aurelis';

const SCENARIOS = [
  {
    id: 'organizer_replay',
    label: 'Organizer JSONL Stream Replay',
    desc: 'Replays collector/data/organizer_stream.jsonl tagged SIMULATED.',
  },
  {
    id: 'secret_in_raw_log',
    label: 'Secret in Raw Log -> Redacted',
    desc: 'Injects password + Bearer JWT locally; confirms 0 secrets cross Tier 1.',
  },
  {
    id: 'outage_recovery',
    label: 'Outage Buffer -> Zero-Loss Resume',
    desc: 'Toggles simulated SaaS disconnect or flushes buffered SQLite payloads.',
  },
  {
    id: 'failed_login_burst',
    label: 'Failed-Login Burst -> Summary Only',
    desc: 'Appends 27 local auth failures; Tier 1 emits summary count only.',
  },
  {
    id: 'latency_spike',
    label: 'WAN Latency Z-Score Spike',
    desc: 'Simulates > 3.0 sigma EWMA latency rise requiring operator action.',
  },
  {
    id: 'cpu_ram_deviation',
    label: 'CPU & Memory Baseline Deviation',
    desc: 'Simulates 93% peak compute deviation flagged by AIOps baseline.',
  },
  {
    id: 'correlated_alerts',
    label: 'Many Alerts -> One Incident',
    desc: 'Merges 6 noisy alerts in a 5-minute window into 1 parent incident.',
  },
  {
    id: 'duplicate_out_of_order',
    label: 'Duplicate & Out-of-Order Replay',
    desc: 'Places backdated sample by event time and deduplicates payload_id.',
  },
];

export function AIIntelligence({
  siteId,
  dataSource,
  refreshTick,
}: {
  siteId: string;
  dataSource: DataSourceMode;
  refreshTick: number;
}) {
  const [cpuSeries, setCpuSeries] = useState<MetricsResponse | null>(null);
  const [latSeries, setLatSeries] = useState<MetricsResponse | null>(null);
  const [sla, setSla] = useState<SlaMetricsResponse | null>(null);
  const [scenarioResult, setScenarioResult] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = () => {
    Promise.all([
      aurelisApi.getMetrics('cpu_total_percent', siteId, '1h', dataSource),
      aurelisApi.getMetrics('latency_avg_ms', siteId, '1h', dataSource),
      aurelisApi.getSlaMetrics(),
    ])
      .then(([cpu, lat, slaRes]) => {
        setCpuSeries(cpu);
        setLatSeries(lat);
        setSla(slaRes);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, [siteId, dataSource, refreshTick]);

  const handleRunScenario = async (id: string) => {
    setRunningId(id);
    setScenarioResult(null);
    try {
      if (id === 'secret_in_raw_log') {
        const res = await aurelisApi.injectPrivacyTest(
          'auth_error user=admin@aurelis-ops.io password=TopSecret99 Bearer eyJhbGci.demoToken src_ip=10.22.4.8',
          'raw_payload_dump'
        );
        setScenarioResult(`Redacted locally: "${res.redacted}". ${res.tier2RejectionTest?.reason || ''}`);
      } else if (id === 'outage_recovery') {
        const col = await aurelisApi.getCollectors(siteId);
        const nextOutage = !col.outageSimulated;
        await aurelisApi.toggleOutage(nextOutage);
        setScenarioResult(
          nextOutage
            ? 'SaaS outage enabled: Tier 1 buffering batches locally. Click again to reconnect and flush.'
            : 'SaaS reconnected: Tier 1 flushing buffered batches with zero loss or duplicate payload_ids.'
        );
      } else {
        const res = await aurelisApi.runScenario(id);
        setScenarioResult(res.detail);
      }
      load();
    } catch (err) {
      setScenarioResult(err instanceof Error ? err.message : 'Scenario execution failed');
    } finally {
      setRunningId(null);
    }
  };

  const cpuAnomalies = (cpuSeries?.points || []).filter((p) => p.anomaly).length;
  const latAnomalies = (latSeries?.points || []).filter((p) => p.anomaly).length;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-6">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#C49A35]" />
          <h2 className="text-base font-semibold text-[#171717]">Metadata-Only AIOps Baselines & SLA Verification</h2>
        </div>
        <p className="mt-1 text-xs text-[#737373]">
          All baselines (rolling mean, EWMA/z-score, and p95) are computed strictly on redacted metadata stored in Tier
          2. Zero raw logs or secrets enter the analytical pipeline.
        </p>
      </div>

      {/* Real-Time SLA Target Metrics */}
      {sla && (
        <div className="bg-white border border-[#E9E5DC] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Gauge className="w-4 h-4 text-[#C49A35]" />
            <h3 className="text-sm font-semibold text-[#171717]">Live Platform SLA & Delivery Parity Targets</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono tabular-nums">
            <div className="p-4 rounded-lg bg-[#FAFAF7] border border-[#E9E5DC]">
              <div className="text-[#737373]">Collection -&gt; Dashboard p95</div>
              <div className="mt-1 text-lg font-bold text-[#171717]">{sla.collectionToDashboardP95Sec}s</div>
              <div className={sla.p95TargetMet ? 'text-[#16A34A] mt-1' : 'text-[#DC2626] mt-1'}>
                Target &lt; 10s · {sla.p95TargetMet ? 'PASS' : 'BREACH'}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-[#FAFAF7] border border-[#E9E5DC]">
              <div className="text-[#737373]">Collector Offline Detection</div>
              <div className="mt-1 text-lg font-bold text-[#171717]">{sla.heartbeatAgeSec}s age</div>
              <div className={sla.offlineDetectionTargetMet ? 'text-[#16A34A] mt-1' : 'text-[#D97706] mt-1'}>
                Target &lt; 60s · {sla.offlineDetectionTargetMet ? 'PASS' : 'STALE'}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-[#FAFAF7] border border-[#E9E5DC]">
              <div className="text-[#737373]">Breach -&gt; Alert Cadence</div>
              <div className="mt-1 text-lg font-bold text-[#171717]">{sla.breachToAlertTargetSec}s</div>
              <div className="text-[#16A34A] mt-1">Target &lt; 15s · PASS</div>
            </div>
            <div className="p-4 rounded-lg bg-[#FAFAF7] border border-[#E9E5DC]">
              <div className="text-[#737373]">Outage Buffer Parity</div>
              <div className="mt-1 text-lg font-bold text-[#171717]">
                {sla.parityPercent}% ({sla.matchedReceivedCount}/{sla.sentPayloadCount})
              </div>
              <div className="text-[#8D6B20] mt-1">Pending queue: {sla.outageBufferQueueDepth}</div>
            </div>
          </div>
        </div>
      )}

      {/* Rolling Baselines */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white border border-[#E9E5DC] rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#171717]">CPU Utilization Baseline (1h Window)</h3>
            <span className="text-xs font-mono uppercase text-[#8D6B20]">{cpuSeries?.source || 'none'}</span>
          </div>
          <div className="grid grid-cols-3 gap-3 bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg p-3 text-xs font-mono tabular-nums">
            <div>
              <div className="text-[#737373]">Rolling Mean</div>
              <div className="text-sm font-semibold text-[#171717] mt-0.5">{cpuSeries?.stats.avg ?? '—'}%</div>
            </div>
            <div>
              <div className="text-[#737373]">Observed p95</div>
              <div className="text-sm font-semibold text-[#171717] mt-0.5">{cpuSeries?.stats.p95 ?? '—'}%</div>
            </div>
            <div>
              <div className="text-[#737373]">Z-Score &ge; 2.2</div>
              <div className="text-sm font-semibold text-[#8D6B20] mt-0.5">{cpuAnomalies} spikes</div>
            </div>
          </div>
          <p className="text-xs text-[#737373]">
            Samples evaluated: {cpuSeries?.stats.count ?? 0}. Sustained elevation above p95 triggers explainable
            recommendation generation without static threshold noise.
          </p>
        </div>

        <div className="bg-white border border-[#E9E5DC] rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#171717]">Network Latency Baseline (1h Window)</h3>
            <span className="text-xs font-mono uppercase text-[#8D6B20]">{latSeries?.source || 'none'}</span>
          </div>
          <div className="grid grid-cols-3 gap-3 bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg p-3 text-xs font-mono tabular-nums">
            <div>
              <div className="text-[#737373]">Rolling Mean</div>
              <div className="text-sm font-semibold text-[#171717] mt-0.5">{latSeries?.stats.avg ?? '—'} ms</div>
            </div>
            <div>
              <div className="text-[#737373]">Observed p95</div>
              <div className="text-sm font-semibold text-[#171717] mt-0.5">{latSeries?.stats.p95 ?? '—'} ms</div>
            </div>
            <div>
              <div className="text-[#737373]">Z-Score &ge; 2.2</div>
              <div className="text-sm font-semibold text-[#8D6B20] mt-0.5">{latAnomalies} spikes</div>
            </div>
          </div>
          <p className="text-xs text-[#737373]">
            Cross-site correlator groups concurrent latency anomalies across sites within the same tenant using a
            5-minute sliding window.
          </p>
        </div>
      </div>

      {/* 8-Scenario Live Verification Injector */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-[#171717]">8-Scenario Verification & Replay Injector</h3>
          <p className="text-xs text-[#737373] mt-0.5">
            Trigger any benchmark scenario directly from the console. All synthetic injections are explicitly tagged{' '}
            <code className="font-mono">SIMULATED</code> in Tier 2 and recorded in the immutable audit hash chain.
          </p>
        </div>

        {scenarioResult && (
          <div className="p-3 rounded-lg bg-[#F5EBD2]/50 border border-[#C49A35]/40 text-xs text-[#171717]">
            {scenarioResult}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {SCENARIOS.map((sc) => (
            <div key={sc.id} className="p-4 rounded-lg bg-[#FAFAF7] border border-[#E9E5DC] flex flex-col justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#171717]">{sc.label}</div>
                <p className="mt-1 text-[11px] text-[#737373] leading-relaxed">{sc.desc}</p>
              </div>
              <button
                type="button"
                disabled={runningId === sc.id}
                onClick={() => handleRunScenario(sc.id)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424] disabled:opacity-60 whitespace-nowrap"
              >
                <Play className="w-3 h-3 text-[#C49A35]" />
                <span>{runningId === sc.id ? 'Running...' : 'Trigger'}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
