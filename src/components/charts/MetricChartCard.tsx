import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { ShieldCheck, X } from 'lucide-react';
import { aurelisApi } from '../../services/api';
import type { DataSourceMode, MetricsResponse, VerifyMetricsResponse } from '../../types/aurelis';

interface MetricChartCardProps {
  title: string;
  metricKey: string;
  siteId: string;
  range: string;
  dataSource: DataSourceMode;
  refreshTick: number;
}

export function MetricChartCard({
  title,
  metricKey,
  siteId,
  range,
  dataSource,
  refreshTick,
}: MetricChartCardProps) {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyData, setVerifyData] = useState<VerifyMetricsResponse | null>(null);

  useEffect(() => {
    let active = true;
    aurelisApi
      .getMetrics(metricKey, siteId, range, dataSource)
      .then((res) => {
        if (!active) return;
        setData(res);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load metric series');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [metricKey, siteId, range, dataSource, refreshTick]);

  const handleVerify = async () => {
    setVerifyOpen(true);
    try {
      const res = await aurelisApi.verifyMetrics(metricKey, siteId);
      setVerifyData(res);
    } catch {
      setVerifyData(null);
    }
  };

  const chartData = (data?.points || []).map((pt) => ({
    ...pt,
    localTime: new Date(pt.timestamp_utc).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  }));

  const latestVal = (() => {
    const pts = data?.points || [];
    for (let i = pts.length - 1; i >= 0; i--) {
      if (pts[i].value !== null) return pts[i].value;
    }
    return null;
  })();

  const sourceLabel =
    data?.source === 'live'
      ? 'LIVE TELEMETRY'
      : data?.source === 'simulated'
        ? 'SIMULATED REFERENCE'
        : 'NO DATA';

  return (
    <div className="bg-white border border-[#E9E5DC] rounded-xl p-5 flex flex-col justify-between">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#171717]">{title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#737373] tabular-nums">
            <span className={data?.source === 'live' ? 'text-[#8D6B20] font-semibold' : 'text-[#737373] font-medium'}>
              {sourceLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span>Unit: {data?.unit || '%'}</span>
            {data?.stats.p95 !== null && data?.stats.p95 !== undefined && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  p95: {data.stats.p95}
                  {data.unit}
                </span>
              </>
            )}
            {data?.isStale && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[#D97706] font-medium">Stale</span>
              </>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-semibold text-[#171717] font-mono tabular-nums">
            {latestVal !== null ? `${latestVal}${data?.unit || ''}` : '—'}
          </div>
          <button
            type="button"
            onClick={handleVerify}
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#8D6B20] hover:text-[#171717] transition-colors whitespace-nowrap"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Verify Raw</span>
          </button>
        </div>
      </div>

      <div className="h-48 w-full">
        {loading && !data ? (
          <div className="h-full flex items-center justify-center text-xs text-[#737373]">Loading telemetry series...</div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-xs text-[#DC2626]">{error}</div>
        ) : chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-[#737373]">
            No {dataSource === 'all' ? '' : `${dataSource} `}data yet for this site & metric window.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E9E5DC" vertical={false} />
              <XAxis
                dataKey="localTime"
                tick={{ fontSize: 10, fill: '#737373' }}
                tickLine={false}
                axisLine={{ stroke: '#E9E5DC' }}
                minTickGap={28}
              />
              <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickLine={false} axisLine={false} width={42} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#171717',
                  border: '1px solid #C49A35',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#FFFFFF',
                }}
                formatter={(val: unknown) => [
                  val === null || val === undefined ? 'Gap (No Sample)' : `${val} ${data?.unit || ''}`,
                  title,
                ]}
                labelFormatter={(_label, payload) => {
                  const pt = payload?.[0]?.payload;
                  return pt?.timestamp_utc ? `UTC: ${pt.timestamp_utc} · ${(pt.source || '').toUpperCase()}` : '';
                }}
              />
              {data?.stats.avg !== null && data?.stats.avg !== undefined && (
                <ReferenceLine y={data.stats.avg} stroke="#8D6B20" strokeDasharray="4 4" strokeOpacity={0.65} />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke="#C49A35"
                strokeWidth={2}
                fill="#F5EBD2"
                fillOpacity={0.55}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-[#E9E5DC] flex items-center justify-between text-[11px] text-[#737373] tabular-nums">
        <span>Samples: {data?.stats.count ?? 0}</span>
        <span>
          {data?.lastUpdatedUtc ? `Last updated ${new Date(data.lastUpdatedUtc).toLocaleTimeString()}` : 'Awaiting sample'}
        </span>
      </div>

      {verifyOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E9E5DC] rounded-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-base font-semibold text-[#171717]">Raw Metric Verification — {title}</h4>
              <button
                type="button"
                onClick={() => setVerifyOpen(false)}
                className="p-1 text-[#737373] hover:text-[#171717]"
                aria-label="Close verification dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {verifyData ? (
              <div className="space-y-3 text-xs font-mono tabular-nums">
                <div className="grid grid-cols-2 gap-3 bg-[#FAFAF7] border border-[#E9E5DC] p-3 rounded-lg">
                  <div>
                    <div className="text-[#737373]">Stored Raw Samples</div>
                    <div className="text-sm font-semibold text-[#171717] mt-0.5">{verifyData.sample_count}</div>
                  </div>
                  <div>
                    <div className="text-[#737373]">Computed Raw p95</div>
                    <div className="text-sm font-semibold text-[#8D6B20] mt-0.5">
                      {verifyData.raw_p95 ?? '—'} {data?.unit}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#737373]">Min / Avg / Max</div>
                    <div className="text-[#171717] mt-0.5">
                      {verifyData.raw_min ?? '—'} / {verifyData.raw_avg ?? '—'} / {verifyData.raw_max ?? '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#737373]">Detected Interval Gaps</div>
                    <div className="text-[#171717] mt-0.5">{verifyData.gaps.length}</div>
                  </div>
                </div>
                <div className="text-[#737373] space-y-1">
                  <div>First UTC: {verifyData.first_timestamp_utc || 'None'}</div>
                  <div>Last UTC: {verifyData.last_timestamp_utc || 'None'}</div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-[#737373]">Querying stored SQLite raw points...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
