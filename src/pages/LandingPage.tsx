import { useEffect, useState } from 'react';
import { ArrowRight, ShieldCheck, Layers, Cpu, Lock } from 'lucide-react';
import { aurelisApi } from '../services/api';
import type { PublicBranding } from '../types/aurelis';

interface LandingPageProps {
  onEnterPortal: (initialTab?: 'signin' | 'register') => void;
}

export function LandingPage({ onEnterPortal }: LandingPageProps) {
  const [branding, setBranding] = useState<PublicBranding>({
    organizationName: 'Aurelis Cloud Ops',
    productName: 'AURELIS',
    logoDataUrl: null,
  });

  useEffect(() => {
    aurelisApi.getPublicBranding().then(setBranding).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#171717] flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="border-b border-[#E9E5DC] bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <a href="#top" className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight text-[#171717] whitespace-nowrap shrink-0">
            {branding.logoDataUrl && (
              <img src={branding.logoDataUrl} alt={branding.productName} className="w-6 h-6 object-contain" />
            )}
            <span>{branding.productName}</span>
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#737373]">
            <a href="#architecture" className="hover:text-[#171717] transition-colors whitespace-nowrap shrink-0">
              Architecture
            </a>
            <a href="#zero-config" className="hover:text-[#171717] transition-colors whitespace-nowrap shrink-0">
              Zero-Config Setup
            </a>
            <a href="#remediation" className="hover:text-[#171717] transition-colors whitespace-nowrap shrink-0">
              Fix-or-Notify
            </a>
            <a href="#multi-site" className="hover:text-[#171717] transition-colors whitespace-nowrap shrink-0">
              Multi-Site
            </a>
          </nav>

          <button
            type="button"
            onClick={() => onEnterPortal('signin')}
            className="px-4 py-2 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424] transition-colors whitespace-nowrap shrink-0"
          >
            Operator Portal
          </button>
        </div>
      </header>

      {/* Hero Split */}
      <main id="top" className="flex-1">
        <section className="max-w-7xl mx-auto px-6 pt-12 pb-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <div className="text-xs font-medium text-[#8D6B20] mb-3">
                CICADA 2026 Enterprise AIOps · {branding.organizationName} · Zero Raw Log Egress
              </div>
              <h1
                className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-[#171717] leading-[1.12]"
                style={{ textWrap: 'balance' }}
              >
                Autonomous infrastructure observability without raw telemetry leaving your perimeter.
              </h1>
              <p className="mt-5 text-base text-[#737373] leading-relaxed max-w-xl">
                {branding.productName} separates local collection from cloud intelligence. Tier 1 collectors scrub
                secrets under GDPR, PCI-DSS, or HIPAA profiles inside your VPC before sending allow-listed metadata to
                Tier 2.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => onEnterPortal('register')}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#171717] text-white text-sm font-medium hover:bg-[#242424] transition-colors whitespace-nowrap"
                >
                  <span>Create Operator Account</span>
                  <ArrowRight className="w-4 h-4 text-[#C49A35]" />
                </button>
                <button
                  type="button"
                  onClick={() => onEnterPortal('signin')}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-white border border-[#E9E5DC] text-sm font-medium text-[#171717] hover:border-[#C49A35] transition-colors whitespace-nowrap"
                >
                  <span>Sign In to Workspace</span>
                </button>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="h-full min-h-[300px] rounded-xl overflow-hidden border border-[#E9E5DC] bg-[#171717]">
                <img
                  src="/src/assets/images/aurelis_hero_architecture_1795354674436.jpg"
                  alt="AURELIS minimalist gold, white, and obsidian enterprise data center architecture"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* 4-Column Proof Strip */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#FAFAF7] border border-[#E9E5DC] rounded-xl p-5">
              <div className="text-xs text-[#737373]">Raw Log Cloud Egress</div>
              <div className="mt-1 text-2xl font-bold text-[#171717] font-mono tabular-nums">0 Bytes</div>
              <div className="mt-1 text-xs text-[#8D6B20]">Scrubbed locally before exit</div>
            </div>
            <div className="bg-[#FAFAF7] border border-[#E9E5DC] rounded-xl p-5">
              <div className="text-xs text-[#737373]">Local Collector Cadence</div>
              <div className="mt-1 text-2xl font-bold text-[#171717] font-mono tabular-nums">5.0 sec</div>
              <div className="mt-1 text-xs text-[#8D6B20]">Monotonic live host & TCP probes</div>
            </div>
            <div className="bg-[#FAFAF7] border border-[#E9E5DC] rounded-xl p-5">
              <div className="text-xs text-[#737373]">External Env Vars Needed</div>
              <div className="mt-1 text-2xl font-bold text-[#171717] font-mono tabular-nums">None</div>
              <div className="mt-1 text-xs text-[#8D6B20]">Auto-bootstrapped at startup</div>
            </div>
            <div className="bg-[#FAFAF7] border border-[#E9E5DC] rounded-xl p-5">
              <div className="text-xs text-[#737373]">Remediation Channel</div>
              <div className="mt-1 text-2xl font-bold text-[#171717] font-mono tabular-nums">Outbound</div>
              <div className="mt-1 text-xs text-[#8D6B20]">Signed allow-listed jobs only</div>
            </div>
          </div>
        </section>

        {/* Zero-Config Explanation Section */}
        <section id="zero-config" className="border-t border-[#E9E5DC] bg-[#FAFAF7] py-14">
          <div className="max-w-7xl mx-auto px-6">
            <div className="max-w-2xl mb-8">
              <h2 className="font-display text-2xl font-bold text-[#171717]">
                Ready immediately with zero manual environment variables
              </h2>
              <p className="mt-2 text-sm text-[#737373]">
                You do not need an external Supabase URL, service role key, or collector URL to run AURELIS. The
                Express server automatically provisions local storage, cryptographic salts, and a live Python Tier 1
                collector daemon on startup, alongside optional Postgres & MailHog via Docker Compose.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div id="architecture" className="bg-white border border-[#E9E5DC] rounded-xl p-6">
                <Cpu className="w-5 h-5 text-[#C49A35] mb-3" />
                <h3 className="text-base font-semibold text-[#171717]">01. Tier 1 Local Collector</h3>
                <p className="mt-2 text-sm text-[#737373] leading-relaxed">
                  Python daemon reads live CPU, memory, disk, network rates, 10x TCP latency probes, and local log
                  counters. Regex redaction and strict field allow-listing run locally before SQLite buffering.
                </p>
              </div>
              <div id="remediation" className="bg-white border border-[#E9E5DC] rounded-xl p-6">
                <ShieldCheck className="w-5 h-5 text-[#C49A35] mb-3" />
                <h3 className="text-base font-semibold text-[#171717]">02. Fix-or-Notify Engine</h3>
                <p className="mt-2 text-sm text-[#737373] leading-relaxed">
                  Classifies every incident into AUTO_FIX, ASK_APPROVAL, or NOTIFY_ONLY based on confidence, risk
                  level, and local policy. Dispatches HMAC-signed allow-listed jobs verified on-host.
                </p>
              </div>
              <div id="multi-site" className="bg-white border border-[#E9E5DC] rounded-xl p-6">
                <Layers className="w-5 h-5 text-[#C49A35] mb-3" />
                <h3 className="text-base font-semibold text-[#171717]">03. Multi-Site Hierarchy</h3>
                <p className="mt-2 text-sm text-[#737373] leading-relaxed">
                  Organizes Tenant to Site to 1:1 Collector to Assets across regions with residency checks, single-use
                  24-hour enrollment tokens, and cross-site parent/child incident correlation.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E9E5DC] bg-white py-6">
        <div className="max-w-7xl mx-auto px-6 flex flex-wrap items-center justify-between gap-4 text-xs text-[#737373]">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-[#C49A35]" />
            <span>{branding.productName} Smart Observability · CICADA 2026</span>
          </div>
          <div>Two-Tier Metadata-Only Architecture · Live & Simulated Sources Explicitly Labeled</div>
        </div>
      </footer>
    </div>
  );
}
