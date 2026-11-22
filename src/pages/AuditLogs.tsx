import { useEffect, useState } from 'react';
import { Download, Search, ShieldCheck, AlertTriangle } from 'lucide-react';
import { aurelisApi } from '../services/api';
import type { AuditLogRecord } from '../types/aurelis';

export function AuditLogs({ siteId, refreshTick }: { siteId: string; refreshTick: number }) {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [chainVerified, setChainVerified] = useState(true);
  const [totalEntries, setTotalEntries] = useState(0);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<'ALL' | 'Tier 1' | 'Tier 2'>('ALL');

  useEffect(() => {
    aurelisApi
      .getAuditLogs(siteId)
      .then((res) => {
        setLogs(res.logs);
        setChainVerified(res.chainVerified);
        setTotalEntries(res.totalEntries);
      })
      .catch(() => {});
  }, [siteId, refreshTick]);

  const filtered = logs.filter((l) => {
    if (tierFilter !== 'ALL' && l.tier !== tierFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      l.actor.toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q) ||
      l.detail.toLowerCase().includes(q)
    );
  });

  const handleExportCsv = () => {
    const header = 'id,timestamp_utc,tier,actor,action,source,entry_hash,detail\n';
    const rows = filtered
      .map((l) =>
        [
          l.id,
          l.timestamp_utc,
          l.tier,
          `"${l.actor.replace(/"/g, '""')}"`,
          l.action,
          l.source,
          l.entry_hash || '',
          `"${l.detail.replace(/"/g, '""')}"`,
        ].join(',')
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aurelis-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Hash-Chain Integrity Banner + Filters */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {chainVerified ? (
            <ShieldCheck className="w-5 h-5 text-[#16A34A] shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-[#DC2626] shrink-0" />
          )}
          <div>
            <div className="text-sm font-semibold text-[#171717]">
              SHA-256 Hash-Chained Audit Ledger:{' '}
              <span className={chainVerified ? 'text-[#16A34A]' : 'text-[#DC2626]'}>
                {chainVerified ? 'VERIFIED INTACT' : 'INTEGRITY MISMATCH'}
              </span>
            </div>
            <div className="text-xs text-[#737373] font-mono tabular-nums">
              Total chained ledger entries for tenant: {totalEntries}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg">
            {(['ALL', 'Tier 1', 'Tier 2'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setTierFilter(tier)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  tierFilter === tier ? 'bg-[#171717] text-white' : 'text-[#737373] hover:text-[#171717]'
                }`}
              >
                {tier}
              </button>
            ))}
          </div>

          <div className="relative min-w-[200px]">
            <Search className="w-4 h-4 text-[#737373] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter actor, action, detail..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-[#E9E5DC] text-xs"
            />
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424] whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-[#C49A35]" />
            <span>Download CSV</span>
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#E9E5DC] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E9E5DC] bg-[#FAFAF7] text-xs font-semibold text-[#737373]">
                <th className="py-3 px-4">Timestamp UTC</th>
                <th className="py-3 px-4">Tier</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Source</th>
                <th className="py-3 px-4">Chain Hash</th>
                <th className="py-3 px-4">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9E5DC] text-xs">
              {filtered.map((l) => (
                <tr key={l.id} className="hover:bg-[#FAFAF7]">
                  <td className="py-3 px-4 font-mono text-[#737373] tabular-nums whitespace-nowrap">{l.timestamp_utc}</td>
                  <td className="py-3 px-4 font-semibold text-[#8D6B20] whitespace-nowrap">{l.tier}</td>
                  <td className="py-3 px-4 font-mono text-[#171717]">{l.actor}</td>
                  <td className="py-3 px-4 font-mono text-[#171717]">{l.action}</td>
                  <td className="py-3 px-4 uppercase text-[#737373]">{l.source}</td>
                  <td className="py-3 px-4 font-mono text-[#737373]">
                    {l.entry_hash ? `${l.entry_hash.slice(0, 12)}...` : '—'}
                  </td>
                  <td className="py-3 px-4 text-[#737373]">{l.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
