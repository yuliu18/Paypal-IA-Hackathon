import Link from 'next/link';

// The small "Live mode" notice on the overview and the guard log, so the owner always knows when
// calls from their shop's app move real money (lib/settings/live-mode.ts). `failClosed`: live mode
// is turned on in Settings, but this server runs in test mode (no ALLOW_LIVE_MODE, or no live app).
export function LiveIndicator({ state, text, settingsLabel }: { state: 'on' | 'failClosed'; text: string; settingsLabel: string }) {
  const tone = state === 'on' ? 'border-pp-danger/40 bg-pp-danger-tint text-pp-danger' : 'border-pp-warning/40 bg-pp-warning-tint text-pp-warning';
  return (
    <p role="status" className={`mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm ${tone}`}>
      <span className="inline-flex items-center gap-2 font-semibold">
        <span aria-hidden className={`h-2 w-2 rounded-full ${state === 'on' ? 'bg-pp-danger' : 'bg-pp-warning'}`} />
        {text}
      </span>
      <Link href="/settings?section=paypal" className="font-semibold underline">
        {settingsLabel}
      </Link>
    </p>
  );
}
