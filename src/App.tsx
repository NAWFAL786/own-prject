import { useEffect, useState } from 'react';
import { aurelisApi, setSessionToken } from './services/api';
import type { DataSourceMode, NavSection, OperatorProfile, PublicBranding, SiteRecord } from './types/aurelis';
import { LandingPage } from './pages/LandingPage';
import { AuthPortal } from './pages/AuthPortal';
import { Sidebar } from './components/layout/Sidebar';
import { TopHeader } from './components/layout/TopHeader';
import { OverviewDashboard } from './pages/OverviewDashboard';
import { InfrastructureMonitoring } from './pages/InfrastructureMonitoring';
import { EnvironmentManagement } from './pages/EnvironmentManagement';
import { CollectorManagement } from './pages/CollectorManagement';
import { PrivacyEgressProof } from './pages/PrivacyEgressProof';
import { IncidentManagement } from './pages/IncidentManagement';
import { AIIntelligence } from './pages/AIIntelligence';
import { AIRecommendations } from './pages/AIRecommendations';
import { AuditLogs } from './pages/AuditLogs';
import { SettingsPage } from './pages/SettingsPage';

const SECTION_TITLES: Record<NavSection, string> = {
  overview: 'Executive Overview',
  infrastructure: 'Infrastructure Monitoring',
  environments: 'Environments & Sites',
  collectors: 'Collector Management',
  privacy: 'Privacy & Egress Proof',
  incidents: 'Incident Management',
  intelligence: 'AI Intelligence',
  recommendations: 'Recommendations',
  audit: 'Audit Logs',
  settings: 'Settings & Environment',
};

export default function App() {
  const [view, setView] = useState<'landing' | 'auth' | 'dashboard'>('landing');
  const [authTab, setAuthTab] = useState<'signin' | 'register'>('signin');
  const [operator, setOperator] = useState<OperatorProfile | null>(null);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [branding, setBranding] = useState<PublicBranding>({
    organizationName: 'Aurelis Cloud Ops',
    productName: 'AURELIS',
    logoDataUrl: null,
  });

  const [section, setSection] = useState<NavSection>('overview');
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('site') || 'all';
  });
  const [dataSource, setDataSource] = useState<DataSourceMode>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const loadSitesAndBranding = () => {
    aurelisApi.getSites().then((res) => setSites(res.sites)).catch(() => {});
    aurelisApi.getPublicBranding().then(setBranding).catch(() => {});
  };

  useEffect(() => {
    if (view !== 'dashboard' || !operator) return;
    loadSitesAndBranding();
    const timer = window.setInterval(() => {
      setRefreshTick((t) => t + 1);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [view, operator]);

  const handleSiteChange = (siteId: string) => {
    setSelectedSiteId(siteId);
    const url = new URL(window.location.href);
    if (siteId === 'all') {
      url.searchParams.delete('site');
    } else {
      url.searchParams.set('site', siteId);
    }
    window.history.replaceState({}, '', url.toString());
  };

  const handleLogout = async () => {
    try {
      await aurelisApi.logout();
    } catch {
      // ignore offline logout
    }
    setSessionToken(null);
    setOperator(null);
    setVerificationNotice(null);
    setView('landing');
  };

  if (view === 'landing') {
    return (
      <LandingPage
        onEnterPortal={(tab = 'signin') => {
          setAuthTab(tab);
          setView('auth');
        }}
      />
    );
  }

  if (view === 'auth' || !operator) {
    return (
      <AuthPortal
        initialTab={authTab}
        onBack={() => setView('landing')}
        onAuthenticated={(op, notice) => {
          setOperator(op);
          setBranding({
            organizationName: op.organizationName,
            productName: op.productName || 'AURELIS',
            logoDataUrl: op.logoDataUrl || null,
          });
          setVerificationNotice(notice || null);
          setView('dashboard');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex bg-[#FAFAF7] text-[#171717]">
      <Sidebar
        active={section}
        onSelect={setSection}
        operator={operator}
        branding={branding}
        onLogout={handleLogout}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopHeader
          sectionTitle={SECTION_TITLES[section]}
          operator={operator}
          branding={branding}
          sites={sites}
          selectedSiteId={selectedSiteId}
          onSiteChange={handleSiteChange}
          dataSource={dataSource}
          onDataSourceChange={setDataSource}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onRefresh={() => setRefreshTick((t) => t + 1)}
          onOpenSettings={() => setSection('settings')}
        />

        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">
          {verificationNotice && (
            <div className="mb-5 p-3 rounded-lg bg-[#F5EBD2]/50 border border-[#C49A35]/40 text-xs text-[#171717] flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono">{verificationNotice}</span>
              <button
                type="button"
                onClick={() => {
                  setSection('settings');
                  setVerificationNotice(null);
                }}
                className="text-xs font-semibold text-[#8D6B20] underline"
              >
                Verify in Settings
              </button>
            </div>
          )}

          {section === 'overview' && (
            <OverviewDashboard
              operator={operator}
              siteId={selectedSiteId}
              dataSource={dataSource}
              onSelectSite={handleSiteChange}
              onNavigate={setSection}
              refreshTick={refreshTick}
            />
          )}
          {section === 'infrastructure' && (
            <InfrastructureMonitoring siteId={selectedSiteId} dataSource={dataSource} refreshTick={refreshTick} />
          )}
          {section === 'environments' && (
            <EnvironmentManagement onSitesUpdated={loadSitesAndBranding} refreshTick={refreshTick} />
          )}
          {section === 'collectors' && (
            <CollectorManagement siteId={selectedSiteId} refreshTick={refreshTick} />
          )}
          {section === 'privacy' && <PrivacyEgressProof refreshTick={refreshTick} />}
          {section === 'incidents' && (
            <IncidentManagement siteId={selectedSiteId} dataSource={dataSource} refreshTick={refreshTick} />
          )}
          {section === 'intelligence' && (
            <AIIntelligence siteId={selectedSiteId} dataSource={dataSource} refreshTick={refreshTick} />
          )}
          {section === 'recommendations' && (
            <AIRecommendations siteId={selectedSiteId} operator={operator} refreshTick={refreshTick} />
          )}
          {section === 'audit' && <AuditLogs siteId={selectedSiteId} refreshTick={refreshTick} />}
          {section === 'settings' && (
            <SettingsPage
              operator={operator}
              sites={sites}
              onBrandingUpdated={loadSitesAndBranding}
              refreshTick={refreshTick}
            />
          )}
        </main>
      </div>
    </div>
  );
}
