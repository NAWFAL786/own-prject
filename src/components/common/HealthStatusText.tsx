import { AlertCircle, CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';
import type { HealthState } from '../../types/aurelis';

export function HealthStatusText({ state }: { state: HealthState }) {
  if (state === 'Excellent') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#16A34A]">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>Excellent</span>
      </span>
    );
  }
  if (state === 'Good') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8D6B20]">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>Good</span>
      </span>
    );
  }
  if (state === 'Fair') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D97706]">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>Fair</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#DC2626]">
      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
      <span>Poor</span>
    </span>
  );
}

export function SeverityText({ severity }: { severity: string }) {
  const s = severity.toLowerCase();
  if (s === 'critical' || s === 'high') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#DC2626]">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span className="capitalize">{s}</span>
      </span>
    );
  }
  if (s === 'medium') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#D97706]">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>Medium</span>
      </span>
    );
  }
  return <span className="text-xs font-medium text-[#737373] capitalize">{s}</span>;
}
