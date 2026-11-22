import {
  LayoutDashboard,
  Server,
  Globe2,
  Cpu,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Wrench,
  FileText,
  Settings,
  LogOut,
  Shield,
} from 'lucide-react';
import type { NavSection, OperatorProfile, PublicBranding } from '../../types/aurelis';

interface SidebarProps {
  active: NavSection;
  onSelect: (section: NavSection) => void;
  operator: OperatorProfile;
  branding: PublicBranding;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'infrastructure', label: 'Infrastructure', icon: Server },
  { id: 'environments', label: 'Environments & Sites', icon: Globe2 },
  { id: 'collectors', label: 'Collector Management', icon: Cpu },
  { id: 'privacy', label: 'Privacy & Egress Proof', icon: ShieldCheck },
  { id: 'incidents', label: 'Incident Management', icon: AlertTriangle },
  { id: 'intelligence', label: 'AI Intelligence', icon: Sparkles },
  { id: 'recommendations', label: 'Recommendations', icon: Wrench },
  { id: 'audit', label: 'Audit Logs', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  active,
  onSelect,
  operator,
  branding,
  onLogout,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const brandTitle = branding.productName || operator.productName || 'AURELIS';
  const orgTitle = branding.organizationName || operator.organizationName;
  const logoUrl = branding.logoDataUrl || operator.logoDataUrl;

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#242424] text-white flex flex-col justify-between border-r border-[#333333] transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="px-6 py-5 border-b border-[#333333] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#171717] border border-[#C49A35]/60 flex items-center justify-center shrink-0 overflow-hidden">
              {logoUrl ? (
                <img src={logoUrl} alt={brandTitle} className="w-full h-full object-contain p-0.5" />
              ) : (
                <Shield className="w-4 h-4 text-[#C49A35]" />
              )}
            </div>
            <div className="min-w-0">
              <div className="font-display text-base font-bold tracking-tight text-white truncate">{brandTitle}</div>
              <div className="text-[11px] text-[#A3A3A3] truncate">{orgTitle}</div>
            </div>
          </div>

          <nav className="px-3 py-4 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelect(item.id);
                    onCloseMobile();
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#171717] text-[#F5EBD2] border border-[#C49A35]/40'
                      : 'text-[#D4D4D4] hover:bg-[#1E1E1E] hover:text-white border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#C49A35]' : 'text-[#A3A3A3]'}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-[#333333] bg-[#1E1E1E]">
          <div className="flex items-center gap-3 mb-3">
            <img
              src="/src/assets/images/aurelis_avatar_operator_1795354674794.jpg"
              alt={operator.fullName}
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-full object-cover border border-[#C49A35]/60 shrink-0 bg-[#242424]"
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">{operator.fullName}</div>
              <div className="text-[11px] text-[#A3A3A3] truncate">{orgTitle}</div>
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] text-[#A3A3A3] mb-2">
            <span className="capitalize">{operator.role.replace('_', ' ')}</span>
            <span className="font-mono">{operator.defaultRegion}</span>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#242424] hover:bg-[#171717] border border-[#3A3A3A] text-xs font-medium text-[#E5E5E5] transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5 text-[#C49A35]" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
