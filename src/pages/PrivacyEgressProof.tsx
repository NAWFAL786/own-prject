import { useEffect, useState } from 'react';
import { ShieldCheck, Play, Download } from 'lucide-react';
import { aurelisApi } from '../services/api';
import type { EgressLogItem, RawPreviewItem, ReceiptItem } from '../types/aurelis';

export function PrivacyEgressProof({ refreshTick }: { refreshTick: number }) {
  const [previews, setPreviews] = useState<RawPreviewItem[]>([]);
  const [egressLogs, setEgressLogs] = useState<EgressLogItem[]>([]);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);

  const [rawInput, setRawInput] = useState(
    'auth_debug user=elena@aurelis-ops.io password=abc123 src_ip=10.42.8.14 Bearer eyJhbGciOiJIUzI1NiJ9.secret'
  );
  const [extraField, setExtraField] = useState('raw_payload_dump');
  const [testResult, setTestResult] = useState<{
    raw: string;
    redacted: string;
    droppedFields: string[];
    tier2RejectionTest: { rejected: boolean; reason: string } | null;
  } | null>(null);

  const load = () => {
    aurelisApi.getRawPreview().then((r) => setPreviews(r.previews)).catch(() => {});
    aurelisApi.getEgressLog().then((r) => setEgressLogs(r.egressLogs)).catch(() => {});
    aurelisApi.getReceivedReceipts().then((r) => setReceipts(r.receipts)).catch(() => {});
  };

  useEffect(() => {
    load();
  }, [refreshTick]);

  const handleRunInjection = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await aurelisApi.injectPrivacyTest(rawInput, extraField);
    setTestResult(res);
    load();
  };

  const handleDownloadProof = () => {
    const proof = {
      generated_at_utc: new Date().toISOString(),
      tier1_local_redaction_samples: previews.slice(0, 5),
      tier1_egress_batches: egressLogs.slice(0, 10),
      tier2_received_receipts: receipts.slice(0, 10),
    };
    const blob = new Blob([JSON.stringify(proof, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aurelis-privacy-egress-proof-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const latestRaw = previews[0];
  const latestEgress = egressLogs[0];
  const latestReceipt = receipts[0];

  const acceptedEgress = egressLogs.filter((e) => e.result === '202_ACCEPTED');
  const matchedEgressCount = acceptedEgress.filter((e) => e.matched_in_saas).length;

  return (
    <div className="space-y-6">
      {/* Live Secret & Allow-List Acceptance Test Simulator */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#C49A35]" />
            <h2 className="text-base font-semibold text-[#171717]">Live Secret-Scrubbing & Allow-List Proof Tester</h2>
          </div>
          <button
            type="button"
            onClick={handleDownloadProof}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E9E5DC] hover:border-[#C49A35] text-xs font-medium text-[#171717] whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-[#C49A35]" />
            <span>Export JSON Proof</span>
          </button>
        </div>
        <p className="text-xs text-[#737373] mb-4">
          Test Tier 1 regex redaction and Tier 2 strict schema rejection without sending raw secrets to the cloud.
        </p>

        <form onSubmit={handleRunInjection} className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-7">
            <label className="block text-xs font-medium text-[#171717] mb-1">Simulated Local Raw Log (Tier 1 Only)</label>
            <input
              type="text"
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs font-mono"
            />
          </div>
          <div className="lg:col-span-3">
            <label className="block text-xs font-medium text-[#171717] mb-1">Unapproved Field Test</label>
            <input
              type="text"
              value={extraField}
              onChange={(e) => setExtraField(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E9E5DC] text-xs font-mono"
            />
          </div>
          <div className="lg:col-span-2">
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#171717] text-white text-xs font-medium hover:bg-[#242424] whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5 text-[#C49A35]" />
              <span>Run Proof</span>
            </button>
          </div>
        </form>

        {testResult && (
          <div className="mt-4 p-4 bg-[#FAFAF7] border border-[#E9E5DC] rounded-lg space-y-2 text-xs font-mono">
            <div>
              <span className="text-[#DC2626] font-semibold">Tier 1 Local Raw:</span> {testResult.raw}
            </div>
            <div>
              <span className="text-[#16A34A] font-semibold">Locally Scrubbed:</span> {testResult.redacted}
            </div>
            <div>
              <span className="text-[#8D6B20] font-semibold">Dropped Fields:</span> {testResult.droppedFields.join(', ')}
            </div>
            {testResult.tier2RejectionTest && (
              <div className="text-[#171717]">
                <span className="font-semibold">Tier 2 Boundary Guard:</span> {testResult.tier2RejectionTest.reason}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Three-Column Verification View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-white border border-[#E9E5DC] rounded-xl p-5">
          <div className="text-xs font-semibold text-[#DC2626]">01. Tier 1 Local Raw Data (Never Leaves VPC)</div>
          <pre className="mt-3 p-3 rounded-lg bg-[#FAFAF7] border border-[#E9E5DC] text-[11px] font-mono whitespace-pre-wrap break-all text-[#171717]">
            {latestRaw ? latestRaw.raw_line : 'Waiting for Tier 1 collector sample...'}
          </pre>
        </div>

        <div className="bg-white border border-[#E9E5DC] rounded-xl p-5">
          <div className="text-xs font-semibold text-[#8D6B20]">02. Locally Scrubbed & Allow-List Filtered</div>
          <pre className="mt-3 p-3 rounded-lg bg-[#FAFAF7] border border-[#E9E5DC] text-[11px] font-mono whitespace-pre-wrap break-all text-[#171717]">
            {latestRaw
              ? `${latestRaw.redacted_line}\n\nDropped Keys: ${latestRaw.dropped_fields}`
              : 'Waiting for redaction output...'}
          </pre>
        </div>

        <div className="bg-white border border-[#E9E5DC] rounded-xl p-5">
          <div className="text-xs font-semibold text-[#16A34A]">03. Exact Approved Metadata Payload (Tier 2)</div>
          <pre className="mt-3 p-3 rounded-lg bg-[#171717] text-[#F5EBD2] text-[11px] font-mono whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
            {latestEgress
              ? JSON.stringify(JSON.parse(latestEgress.payload_json), null, 2)
              : 'Waiting for first signed egress batch...'}
          </pre>
        </div>
      </div>

      {/* Tier 1 Egress vs Tier 2 Receipt Parity Comparison */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E9E5DC] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[#171717]">
              Tier 1 Egress vs Tier 2 Receipt Parity Check
            </h3>
            <p className="text-xs text-[#737373]">
              Verifies that every accepted outbound batch matches an immutable SHA-256 receipt in Tier 2.
            </p>
          </div>
          <span className="text-xs font-mono font-semibold text-[#16A34A] tabular-nums">
            Matched: {matchedEgressCount}/{acceptedEgress.length} batches · Latest Chain:{' '}
            {latestReceipt?.payload_sha256.slice(0, 12) || '—'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E9E5DC] bg-[#FAFAF7] text-xs font-semibold text-[#737373]">
                <th className="py-2.5 px-4">Payload ID</th>
                <th className="py-2.5 px-4">Tier 1 Result</th>
                <th className="py-2.5 px-4 text-right">Bytes</th>
                <th className="py-2.5 px-4">Tier 2 Parity</th>
                <th className="py-2.5 px-4">Timestamp UTC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9E5DC] text-xs font-mono tabular-nums">
              {egressLogs.map((e) => (
                <tr key={e.id}>
                  <td className="py-2.5 px-4 text-[#171717]">{e.payload_id}</td>
                  <td className="py-2.5 px-4 text-[#8D6B20]">{e.result}</td>
                  <td className="py-2.5 px-4 text-right">{e.byte_size}</td>
                  <td className="py-2.5 px-4">
                    <span className={e.matched_in_saas ? 'text-[#16A34A] font-semibold' : 'text-[#D97706]'}>
                      {e.matched_in_saas ? 'MATCHED IN TIER 2' : 'PENDING'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-[#737373]">{e.timestamp_utc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cryptographic Receipt Table */}
      <div className="bg-white border border-[#E9E5DC] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E9E5DC] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#171717]">
            Tier 2 Received Metadata Receipts (SHA-256 Attestation Chain)
          </h3>
          <span className="text-xs font-mono text-[#737373]">Total shown: {receipts.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E9E5DC] bg-[#FAFAF7] text-xs font-semibold text-[#737373]">
                <th className="py-2.5 px-4">Payload ID</th>
                <th className="py-2.5 px-4">Region</th>
                <th className="py-2.5 px-4">Source</th>
                <th className="py-2.5 px-4 text-right">Records</th>
                <th className="py-2.5 px-4">SHA-256 Receipt</th>
                <th className="py-2.5 px-4">Received UTC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9E5DC] text-xs font-mono tabular-nums">
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5 px-4 text-[#171717]">{r.payload_id}</td>
                  <td className="py-2.5 px-4">{r.region}</td>
                  <td className="py-2.5 px-4 uppercase text-[#8D6B20]">{r.source}</td>
                  <td className="py-2.5 px-4 text-right">{r.record_count}</td>
                  <td className="py-2.5 px-4 text-[#737373]">{r.payload_sha256.slice(0, 20)}...</td>
                  <td className="py-2.5 px-4 text-[#737373]">{r.received_at_utc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
