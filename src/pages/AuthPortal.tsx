import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Shield } from 'lucide-react';
import { aurelisApi, setSessionToken } from '../services/api';
import type { OperatorProfile } from '../types/aurelis';

interface AuthPortalProps {
  initialTab?: 'signin' | 'register';
  onBack: () => void;
  onAuthenticated: (operator: OperatorProfile, verificationNotice?: string) => void;
}

const COUNTRY_PROFILES = [
  { code: 'IN', label: 'India (IN)', region: 'ap-south-1', timezone: 'Asia/Kolkata' },
  { code: 'DE', label: 'Germany (DE)', region: 'eu-central-1', timezone: 'Europe/Berlin' },
  { code: 'IE', label: 'Ireland (IE)', region: 'eu-west-1', timezone: 'Europe/Dublin' },
  { code: 'US', label: 'United States East (US)', region: 'us-east-1', timezone: 'America/New_York' },
  { code: 'US-W', label: 'United States West (US)', region: 'us-west-2', timezone: 'America/Los_Angeles' },
  { code: 'GB', label: 'United Kingdom (GB)', region: 'eu-west-1', timezone: 'Europe/London' },
];

export function AuthPortal({ initialTab = 'signin', onBack, onAuthenticated }: AuthPortalProps) {
  const [tab, setTab] = useState<'signin' | 'register' | 'reset'>(initialTab);
  const [hasOperators, setHasOperators] = useState<boolean | null>(null);

  // Sign-In state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Registration state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regMode, setRegMode] = useState<'join_workspace' | 'new_tenant'>('join_workspace');
  const [orgName, setOrgName] = useState('');
  const [countryCode, setCountryCode] = useState('IN');
  const [region, setRegion] = useState('ap-south-1');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [sectorTag, setSectorTag] = useState('it');
  const [complianceProfile, setComplianceProfile] = useState('gdpr');

  // Password reset state
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    aurelisApi
      .getAuthStatus()
      .then((res) => {
        setHasOperators(res.hasOperators);
        if (!res.hasOperators) {
          setTab('register');
        }
      })
      .catch(() => setHasOperators(true));
  }, []);

  const handleCountryChange = (selectedCode: string) => {
    setCountryCode(selectedCode);
    const match = COUNTRY_PROFILES.find((c) => c.code === selectedCode);
    if (match) {
      setRegion(match.region);
      setTimezone(match.timezone);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await aurelisApi.login(loginEmail, loginPassword);
      setSessionToken(res.token);
      onAuthenticated(res.operator);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const cleanCountry = countryCode.slice(0, 2);
      const res = await aurelisApi.register({
        email: regEmail,
        password: regPassword,
        fullName: regName,
        mode: regMode,
        organizationName: regMode === 'new_tenant' ? orgName : undefined,
        countryCode: cleanCountry,
        region,
        timezone,
        sectorTag,
        complianceProfile,
      });
      setSessionToken(res.token);
      onAuthenticated(res.operator, res.emailVerificationNotice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operator registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetNotice(null);
    setSubmitting(true);
    try {
      const res = await aurelisApi.forgotPassword(forgotEmail);
      setResetNotice(
        res.previewResetCode
          ? `${res.message} Preview reset code: ${res.previewResetCode}`
          : `${res.message} Open MailHog (:8025) to copy your 15-minute reset code.`
      );
      if (res.previewResetCode) {
        setResetCode(res.previewResetCode);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send reset email');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await aurelisApi.resetPassword(resetCode, newPassword);
      setResetNotice('Password updated cleanly. You can now sign in.');
      setTab('signin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAF7] flex flex-col justify-center py-10 px-4">
      <div className="max-w-xl w-full mx-auto">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-medium text-[#737373] hover:text-[#171717] mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Overview</span>
        </button>

        <div className="bg-white border border-[#E9E5DC] rounded-xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-[#171717] flex items-center justify-center">
              <Shield className="w-4 h-4 text-[#C49A35]" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-[#171717]">AURELIS Operator Portal</h1>
              <p className="text-xs text-[#737373]">Aurelis Cloud Ops · Two-Tier Multi-Site AIOps Console</p>
            </div>
          </div>

          <div className="mb-6 bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg p-3.5 text-xs text-[#171717] flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Zero-Config Local Environment Ready:</span> No Supabase URL, Service Role
              Key, Collector URL, or <code className="font-mono">.env</code> secrets required. Uses MailHog SMTP when
              available with safe local fallback.
            </div>
          </div>

          {/* Segmented Mode Switch */}
          <div className="flex items-center gap-1 p-1 bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg mb-6">
            <button
              type="button"
              onClick={() => {
                setTab('signin');
                setError(null);
              }}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'signin' ? 'bg-[#171717] text-white' : 'text-[#737373] hover:text-[#171717]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setError(null);
              }}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'register' ? 'bg-[#171717] text-white' : 'text-[#737373] hover:text-[#171717]'
              }`}
            >
              Create Operator
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('reset');
                setError(null);
              }}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'reset' ? 'bg-[#171717] text-white' : 'text-[#737373] hover:text-[#171717]'
              }`}
            >
              Reset Password
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg border border-[#DC2626]/30 bg-[#FEF2F2] text-xs text-[#DC2626]">
              {error}
            </div>
          )}
          {resetNotice && (
            <div className="mb-4 p-3 rounded-lg border border-[#C49A35]/40 bg-[#F5EBD2]/40 text-xs text-[#171717] font-mono break-all">
              {resetNotice}
            </div>
          )}

          {tab === 'signin' && (
            <form onSubmit={handleLogin} className="space-y-4">
              {hasOperators === false && (
                <div className="text-xs text-[#8D6B20] bg-[#F5EBD2]/40 border border-[#C49A35]/30 rounded-lg p-3">
                  No operator accounts exist yet. Switch to Create Operator to register your first Owner account.
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1.5">Operator Email</label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="Enter your operator email"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#E9E5DC] bg-white text-sm text-[#171717] focus:outline-none focus:border-[#C49A35]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1.5">Password</label>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#E9E5DC] bg-white text-sm text-[#171717] focus:outline-none focus:border-[#C49A35]"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg bg-[#171717] text-white text-sm font-medium hover:bg-[#242424] disabled:opacity-60 transition-colors"
              >
                {submitting ? 'Verifying Credentials...' : 'Sign In to Dashboard'}
              </button>
            </form>
          )}

          {tab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#171717] mb-1.5">Full Name</label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Elena Vance"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#E9E5DC] bg-white text-sm text-[#171717] focus:outline-none focus:border-[#C49A35]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#171717] mb-1.5">Work Email</label>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="operator@aurelis-ops.io"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#E9E5DC] bg-white text-sm text-[#171717] focus:outline-none focus:border-[#C49A35]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1.5">Password (min 8 characters)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="Choose a strong password"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#E9E5DC] bg-white text-sm text-[#171717] focus:outline-none focus:border-[#C49A35]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1.5">Workspace Provisioning</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRegMode('join_workspace')}
                    className={`p-3 rounded-lg border text-left text-xs transition-colors ${
                      regMode === 'join_workspace'
                        ? 'border-[#C49A35] bg-[#F5EBD2]/40 text-[#171717]'
                        : 'border-[#E9E5DC] bg-white text-[#737373]'
                    }`}
                  >
                    <div className="font-semibold text-[#171717]">Aurelis Cloud Ops (IT / GDPR)</div>
                    <div className="mt-0.5">Includes Bengaluru Live Collector, Mumbai DC & Frankfurt Hub</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegMode('new_tenant')}
                    className={`p-3 rounded-lg border text-left text-xs transition-colors ${
                      regMode === 'new_tenant'
                        ? 'border-[#C49A35] bg-[#F5EBD2]/40 text-[#171717]'
                        : 'border-[#E9E5DC] bg-white text-[#737373]'
                    }`}
                  >
                    <div className="font-semibold text-[#171717]">Create New Organization</div>
                    <div className="mt-0.5">Isolated multi-site tenant with country, industry & compliance</div>
                  </button>
                </div>
              </div>

              {regMode === 'new_tenant' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-[#171717] mb-1">Organization Name</label>
                    <input
                      type="text"
                      required
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Nordic FinTech Ops"
                      className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#171717] mb-1">Country (Auto-Maps Region & TZ)</label>
                    <select
                      value={countryCode}
                      onChange={(e) => handleCountryChange(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs bg-white"
                    >
                      {COUNTRY_PROFILES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label} · {c.region}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#171717] mb-1">Industry Template</label>
                    <select
                      value={sectorTag}
                      onChange={(e) => setSectorTag(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs bg-white"
                    >
                      <option value="it">IT / SaaS</option>
                      <option value="banking">Banking & Payments</option>
                      <option value="healthcare">Healthcare</option>
                      <option value="retail">Retail & E-Commerce</option>
                      <option value="manufacturing">Manufacturing</option>
                      <option value="telecom">Telecom</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#171717] mb-1">Compliance Profile</label>
                    <select
                      value={complianceProfile}
                      onChange={(e) => setComplianceProfile(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs bg-white"
                    >
                      <option value="gdpr">GDPR (7d raw retention, strict PII)</option>
                      <option value="pci_dss">PCI-DSS (Card PAN + CVV scrub)</option>
                      <option value="hipaa">HIPAA (Health/MRN scrub)</option>
                      <option value="rbi">RBI Data Residency</option>
                    </select>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg bg-[#171717] text-white text-sm font-medium hover:bg-[#242424] disabled:opacity-60 transition-colors"
              >
                {submitting ? 'Provisioning Operator...' : 'Create Operator & Launch Dashboard'}
              </button>
            </form>
          )}

          {tab === 'reset' && (
            <div className="space-y-5">
              <form onSubmit={handleRequestReset} className="space-y-3">
                <div className="text-xs text-[#737373]">
                  Dispatches a 15-minute reset token via MailHog SMTP (<code className="font-mono">127.0.0.1:1025</code>)
                  or safe local preview fallback.
                </div>
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="Enter registered operator email"
                    className="flex-1 px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs"
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424] whitespace-nowrap"
                  >
                    Send Code
                  </button>
                </div>
              </form>

              <form onSubmit={handleCompleteReset} className="space-y-3 pt-4 border-t border-[#E9E5DC]">
                <div>
                  <label className="block text-xs font-medium text-[#171717] mb-1">Reset Code</label>
                  <input
                    type="text"
                    required
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    placeholder="aur_rst_..."
                    className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#171717] mb-1">New Password (min 8 chars)</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#C49A35] text-[#171717] text-xs font-semibold hover:bg-[#B68A27]"
                >
                  Apply New Password
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
