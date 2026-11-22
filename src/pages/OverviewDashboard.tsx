import { useEffect, useState } from 'react';
import { Server, CheckCircle2, AlertTriangle, Cpu, Activity, ArrowRight } from 'lucide-react';
import { aurelisApi } from '../services/api';
import type { DataSourceMode, IncidentRecord, NavSection, OperatorProfile, OverviewResponse } from '../types/aurelis';
import { MetricChartCard } from '../components/charts/MetricChartCard';
import { HealthStatusText, SeverityText } from '../components/common/HealthStatusText';

interface OverviewDashboardProps {
  operator: OperatorProfile;
  siteId: string;
  dataSource: DataSourceMode;
  onSelectSite: (siteId: string) => void;
  onNavigate: (section: NavSection) => void;
  refreshTick: number;
}

const TIME_RANGES = [
  { id: '15m', label: 'Last 15 minutes' },
  { id: '1h', label: '1 hour' },
  { id: '6h', label: '6 hours' },
  { id: '24h', label: '24 hours' },
];

export function OverviewDashboard({
  operator,
  siteId,
  dataSource,
  onSelectSite,
  onNavigate,
  refreshTick,
}: OverviewDashboardProps) {
  const [range, setRange] = useState('15m');
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([aurelisApi.getOverview(siteId, dataSource), aurelisApi.getIncidents(siteId, dataSource)])
      .then(([ov, inc]) => {
        if (!active) return;
        setOverview(ov);
        setIncidents(inc.incidents.slice(0, 4));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [siteId, dataSource, refreshTick]);

  const totals = overview?.totals;
  const dist = overview?.healthDistribution || { Excellent: 0, Good: 0, Fair: 0, Poor: 0 };
  const totalHealth = Math.max(1, dist.Excellent + dist.Good + dist.Fair + dist.Poor);

  const sectorFocusNote =
    operator.sectorTag === 'banking'
      ? 'Payment gateway RTT & PCI-DSS redaction priority active'
      : operator.sectorTag === 'healthcare'
        ? 'Clinical uptime SLA & HIPAA PHI scrub active'
        : 'IT infrastructure compute, WAN latency & GDPR redaction active';

  const kpis = [
    {
      label: 'Total Monitored Servers',
      value: totals ? String(totals.totalServers) : '—',
      sub: `Salted source_id · ${dataSource.toUpperCase()}`,
      icon: Server,
    },
    {
      label: 'Healthy Systems',
      value: totals ? String(totals.healthyServers) : '—',
      sub: 'Excellent & Good states',
      icon: CheckCircle2,
    },
    {
      label: 'Active Incidents',
      value: totals ? String(totals.activeIncidents) : '—',
      sub: 'Correlated across 5m window',
      icon: AlertTriangle,
    },
    {
      label: 'Connected Collectors',
      value: totals ? `${totals.onlineCollectors}/${totals.totalCollectors}` : '—',
      sub: 'Tier 1 outbound heartbeats',
      icon: Cpu,
    },
    {
      label: 'Average Network Latency',
      value: totals ? `${totals.avgLatencyMs} ms` : '—',
      sub: '10-probe TCP/ICMP mean',
      icon: Activity,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Executive Welcome */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-[#8D6B20]">
            Executive Telemetry · {operator.organizationName} · {sectorFocusNote}
          </div>
          <h2 className="mt-1 font-display text-2xl font-bold text-[#171717]">
            Welcome back, {operator.fullName.split(' ')[0]}
          </h2>
          <p className="mt-1 text-sm text-[#737373]">
            Bengaluru live host collector streams every 5s alongside multi-site simulated reference nodes. Active filter:{' '}
            <span className="font-mono font-semibold text-[#171717] uppercase">{dataSource}</span>.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg">
          {TIME_RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                range === r.id ? 'bg-[#171717] text-white' : 'text-[#737373] hover:text-[#171717]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* 5 Main KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="bg-white border border-[#E9E5DC] rounded-xl p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#737373]">{k.label}</span>
                <Icon className="w-4 h-4 text-[#C49A35] shrink-0" />
              </div>
              <div className="mt-3 text-2xl font-bold text-[#171717] font-mono tabular-nums">{k.value}</div>
              <div className="mt-1 text-xs text-[#8D6B20]">{k.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Site Overview Cards */}
      {overview && overview.siteCards.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[#171717]">Site Health Topology</h3>
            <button
              type="button"
              onClick={() => onNavigate('environments')}
              className="text-xs font-medium text-[#8D6B20] hover:text-[#171717] inline-flex items-center gap-1"
            >
              <span>Manage Sites & Onboarding</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {overview.siteCards.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSite(s.id === siteId ? 'all' : s.id)}
                className={`text-left bg-white border rounded-xl p-4 transition-colors ${
                  siteId === s.id ? 'border-[#C49A35] bg-[#FAFAF7]' : 'border-[#E9E5DC] hover:border-[#C49A35]/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#171717] truncate">{s.name}</span>
                  <HealthStatusText state={s.healthState || 'Good'} />
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-[#737373] tabular-nums">
                  <span className="font-mono">{s.region}</span>
                  <span aria-hidden="true">·</span>
                  <span className={s.dataSource === 'live' ? 'uppercase font-semibold text-[#8D6B20]' : 'uppercase'}>
                    {s.dataSource}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{s.onlineCollectors ?? 0} collector online</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-[#737373] tabular-nums">
                  <span>Active incidents: {s.activeIncidents ?? 0}</span>
                  <span>{s.last_seen_utc ? new Date(s.last_seen_utc).toLocaleTimeString() : 'Pending'}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 6 Monitoring Graphs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
        <MetricChartCard title="CPU Utilization" metricKey="cpu_total_percent" siteId={siteId} range={range} dataSource={dataSource} refreshTick={refreshTick} />
        <MetricChartCard title="Memory Utilization" metricKey="ram_usage_percent" siteId={siteId} range={range} dataSource={dataSource} refreshTick={refreshTick} />
        <MetricChartCard title="Disk Utilization" metricKey="disk_usage_percent" siteId={siteId} range={range} dataSource={dataSource} refreshTick={refreshTick} />
        <MetricChartCard title="Network Latency" metricKey="latency_avg_ms" siteId={siteId} range={range} dataSource={dataSource} refreshTick={refreshTick} />
        <MetricChartCard title="Packet Loss" metricKey="packet_loss_percent" siteId={siteId} range={range} dataSource={dataSource} refreshTick={refreshTick} />
        <MetricChartCard title="Server Availability" metricKey="service_availability_percent" siteId={siteId} range={range} dataSource={dataSource} refreshTick={refreshTick} />
      </div>

      {/* Bottom Split: System Health Distribution + Recent Incidents */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-[#E9E5DC] rounded-xl p-6">
          <h3 className="text-sm font-semibold text-[#171717]">System Health Distribution</h3>
          <p className="text-xs text-[#737373] mt-1">
            Classified from real-time metadata baselines and staleness rules.
          </p>
          <div className="mt-5 space-y-4">
            {(['Excellent', 'Good', 'Fair', 'Poor'] as const).map((state) => {
              const count = dist[state] || 0;
              const pct = Math.round((count / totalHealth) * 100);
              const barColor =
                state === 'Excellent'
                  ? 'bg-[#16A34A]'
                  : state === 'Good'
                    ? 'bg-[#C49A35]'
                    : state === 'Fair'
                      ? 'bg-[#D97706]'
                      : 'bg-[#DC2626]';
              return (
                <div key={state}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <HealthStatusText state={state} />
                    <span className="font-mono text-[#171717] tabular-nums">
                      {count} sources ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#FAFAF7] border border-[#E9E5DC] rounded-full overflow-hidden">
                    <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-[#E9E5DC] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#171717]">Recent Incidents & Fix-or-Notify Decisions</h3>
            <button
              type="button"
              onClick={() => onNavigate('incidents')}
              className="text-xs font-medium text-[#8D6B20] hover:text-[#171717]"
            >
              View All
            </button>
          </div>
          {incidents.length === 0 ? (
            <div className="text-xs text-[#737373] py-6">No {dataSource === 'all' ? '' : `${dataSource} `}incidents reported for this site scope.</div>
          ) : (
            <div className="divide-y divide-[#E9E5DC]">
              {incidents.map((inc) => (
                <div key={inc.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#171717] truncate">{inc.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-[#737373] tabular-nums">
                      <SeverityText severity={inc.severity} />
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[#8D6B20]">{inc.decision_mode}</span>
                      <span aria-hidden="true">·</span>
                      <span>{inc.merged_alert_count} alerts merged</span>
                      <span aria-hidden="true">·</span>
                      <span className={inc.source === 'live' ? 'uppercase font-semibold text-[#16A34A]' : 'uppercase'}>
                        {inc.source}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-[#171717] capitalize">{inc.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
