import { useEffect, useState } from 'react';
import { Menu, RefreshCw, CheckCircle2 } from 'lucide-react';
import type { DataSourceMode, OperatorProfile, PublicBranding, SiteRecord } from '../../types/aurelis';

interface TopHeaderProps {
  sectionTitle: string;
  operator: OperatorProfile;
  branding: PublicBranding;
  sites: SiteRecord[];
  selectedSiteId: string;
  onSiteChange: (siteId: string) => void;
  dataSource: DataSourceMode;
  onDataSourceChange: (mode: DataSourceMode) => void;
  onOpenMobileMenu: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

const SOURCE_OPTIONS: Array<{ id: DataSourceMode; label: string }> = [
  { id: 'all', label: 'All Sources' },
  { id: 'live', label: 'Live' },
  { id: 'simulated', label: 'Simulated' },
];

export function TopHeader({
  sectionTitle,
  operator,
  branding,
  sites,
  selectedSiteId,
  onSiteChange,
  dataSource,
  onDataSourceChange,
  onOpenMobileMenu,
  onRefresh,
  onOpenSettings,
}: TopHeaderProps) {
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const orgName = branding.organizationName || operator.organizationName;

  return (
    <header className="bg-white border-b border-[#E9E5DC] px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-lg border border-[#E9E5DC] text-[#171717]"
          aria-label="Open menu"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-[#737373]">
            <span>{orgName}</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#171717] font-medium truncate">{sectionTitle}</span>
          </div>
          <h1 className="text-lg font-semibold text-[#171717] tracking-tight truncate">
            {sectionTitle}
          </h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Global Live / Simulated / All Data-Source Switch */}
        <div
          className="flex items-center gap-1 p-0.5 bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg"
          role="group"
          aria-label="Telemetry data source filter"
        >
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onDataSourceChange(opt.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                dataSource === opt.id ? 'bg-[#171717] text-white' : 'text-[#737373] hover:text-[#171717]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="global-site-select" className="text-xs font-medium text-[#737373] whitespace-nowrap">
            Site Scope
          </label>
          <select
            id="global-site-select"
            value={selectedSiteId}
            onChange={(e) => onSiteChange(e.target.value)}
            className="bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg px-3 py-1.5 text-xs font-medium text-[#171717] focus:outline-none focus:border-[#C49A35]"
          >
            <option value="all">All Sites ({sites.length})</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.region})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FAFAF7] border border-[#E9E5DC] text-xs font-medium text-[#171717] hover:border-[#C49A35] transition-colors whitespace-nowrap shrink-0"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />
          <span>Zero-Config Local</span>
        </button>

        <div className="hidden md:block text-xs font-mono text-[#737373] tabular-nums whitespace-nowrap">
          {clock.toISOString().slice(11, 19)} UTC
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424] transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#C49A35]" />
          <span>Sync</span>
        </button>
      </div>
    </header>
  );
}
