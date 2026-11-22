import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { aurelisApi } from '../services/api';
import type { DataSourceMode, HealthState, InfrastructureNode } from '../types/aurelis';
import { HealthStatusText } from '../components/common/HealthStatusText';

export function InfrastructureMonitoring({
  siteId,
  dataSource,
  refreshTick,
}: {
  siteId: string;
  dataSource: DataSourceMode;
  refreshTick: number;
}) {
  const [nodes, setNodes] = useState<InfrastructureNode[]>([]);
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<'ALL' | HealthState>('ALL');
  const [selectedNode, setSelectedNode] = useState<InfrastructureNode | null>(null);

  useEffect(() => {
    aurelisApi
      .getInfrastructure(siteId, dataSource)
      .then((res) => setNodes(res.nodes))
      .catch(() => {});
  }, [siteId, dataSource, refreshTick]);

  const filtered = nodes.filter((n) => {
    if (healthFilter !== 'ALL' && n.health_state !== healthFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        n.source_id.toLowerCase().includes(q) ||
        n.site_name.toLowerCase().includes(q) ||
        n.region.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-[#737373] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by pseudonymous source_id, site, or region..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#E9E5DC] text-xs text-[#171717] focus:outline-none focus:border-[#C49A35]"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg">
          {(['ALL', 'Excellent', 'Good', 'Fair', 'Poor'] as const).map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => setHealthFilter(state)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                healthFilter === state ? 'bg-[#171717] text-white' : 'text-[#737373] hover:text-[#171717]'
              }`}
            >
              {state}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-[#E9E5DC] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E9E5DC] bg-[#FAFAF7] text-xs font-semibold text-[#737373]">
                <th className="py-3 px-4">Pseudonymous Source ID</th>
                <th className="py-3 px-4">Site & Region</th>
                <th className="py-3 px-4">Source Type</th>
                <th className="py-3 px-4 text-right">CPU</th>
                <th className="py-3 px-4 text-right">RAM</th>
                <th className="py-3 px-4 text-right">Disk</th>
                <th className="py-3 px-4 text-right">Latency</th>
                <th className="py-3 px-4">Health & Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9E5DC] text-xs">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[#737373]">
                    No infrastructure sources match the active filter.
                  </td>
                </tr>
              ) : (
                filtered.map((n) => (
                  <tr
                    key={`${n.site_id}:${n.source_id}:${n.source}`}
                    onClick={() => setSelectedNode(n)}
                    className="hover:bg-[#FAFAF7] cursor-pointer"
                  >
                    <td className="py-3 px-4 font-mono font-medium text-[#171717]">{n.source_id}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-[#171717]">{n.site_name}</div>
                      <div className="text-[11px] text-[#737373] font-mono">{n.region}</div>
                    </td>
                    <td className="py-3 px-4 uppercase font-semibold text-[#8D6B20]">{n.source}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{n.cpu !== null ? `${n.cpu}%` : '—'}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{n.ram !== null ? `${n.ram}%` : '—'}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{n.disk !== null ? `${n.disk}%` : '—'}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {n.latency !== null ? `${n.latency} ms` : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <HealthStatusText state={n.health_state} />
                      <div className="text-[11px] text-[#737373] mt-0.5 truncate max-w-[200px]">
                        {n.health_reason || 'Within baseline'}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedNode && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-end">
          <div className="bg-white border-l border-[#E9E5DC] h-full w-full max-w-md p-6 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-mono text-[#8D6B20] uppercase">{selectedNode.source} telemetry</div>
                  <h3 className="text-base font-bold font-mono text-[#171717] mt-0.5">{selectedNode.source_id}</h3>
                  <div className="text-xs text-[#737373]">
                    {selectedNode.site_name} · {selectedNode.region}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedNode(null)}
                  className="p-1.5 rounded-lg border border-[#E9E5DC] text-[#737373] hover:text-[#171717]"
                  aria-label="Close source drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#737373]">Current Health Classification</span>
                  <HealthStatusText state={selectedNode.health_state} />
                </div>
                <div className="text-[#171717] pt-1 border-t border-[#E9E5DC]">
                  <span className="font-semibold">Classification Reason:</span>{' '}
                  {selectedNode.health_reason || 'Within rolling metadata baseline'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono tabular-nums">
                <div className="p-3 bg-white border border-[#E9E5DC] rounded-lg">
                  <div className="text-[#737373]">CPU Utilization</div>
                  <div className="text-base font-bold text-[#171717] mt-1">
                    {selectedNode.cpu !== null ? `${selectedNode.cpu}%` : '—'}
                  </div>
                </div>
                <div className="p-3 bg-white border border-[#E9E5DC] rounded-lg">
                  <div className="text-[#737373]">Memory Utilization</div>
                  <div className="text-base font-bold text-[#171717] mt-1">
                    {selectedNode.ram !== null ? `${selectedNode.ram}%` : '—'}
                  </div>
                </div>
                <div className="p-3 bg-white border border-[#E9E5DC] rounded-lg">
                  <div className="text-[#737373]">Disk Utilization</div>
                  <div className="text-base font-bold text-[#171717] mt-1">
                    {selectedNode.disk !== null ? `${selectedNode.disk}%` : '—'}
                  </div>
                </div>
                <div className="p-3 bg-white border border-[#E9E5DC] rounded-lg">
                  <div className="text-[#737373]">Network Latency</div>
                  <div className="text-base font-bold text-[#171717] mt-1">
                    {selectedNode.latency !== null ? `${selectedNode.latency} ms` : '—'}
                  </div>
                </div>
              </div>

              <div className="text-xs text-[#737373] font-mono">
                Last Seen UTC: {selectedNode.last_seen_utc}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="w-full py-2.5 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424]"
            >
              Close Inspection Drawer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
