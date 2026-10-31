import { useTranslations } from 'next-intl';
import type { AuditEntry } from '@/lib/guard/ports';

// What the guard did with a call, said the same way on every page: it passed to PayPal, it waits
// for a person, or it was stopped before PayPal saw it.
// `label`: the message, the verdicts' from common.json, the other two from desks.json.
const STAMPS: Record<AuditEntry['outcome'], { label: string; className: string }> = {
  executed: { label: 'common.verdicts.passed', className: 'border-pp-success/40 bg-pp-success-tint text-pp-success' },
  held: { label: 'common.verdicts.held', className: 'border-pp-warning/40 bg-pp-warning-tint text-pp-warning' },
  blocked: { label: 'common.verdicts.stopped', className: 'border-pp-danger/40 bg-pp-danger-tint text-pp-danger' },
  error: { label: 'desks.stamps.error', className: 'border-pp-border bg-pp-canvas text-pp-muted' },
  pending: { label: 'desks.stamps.pending', className: 'border-pp-border bg-pp-canvas text-pp-muted' },
};

export function VerdictStamp({ outcome, className = '' }: { outcome: AuditEntry['outcome']; className?: string }) {
  const t = useTranslations();
  const stamp = STAMPS[outcome];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-[3px] border px-2 py-0.5 text-xs font-semibold ${stamp.className} ${className}`}>
      {t(stamp.label)}
    </span>
  );
}
