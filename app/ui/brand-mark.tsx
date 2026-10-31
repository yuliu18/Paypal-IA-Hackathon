// The app's mark, the same drawing as the browser tab's icon (app/icon.svg): a gate with three calls
// reaching it. Green goes through to PayPal, amber waits at the gate for a person, red stops before it.
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`shrink-0 ${className}`} aria-hidden>
      <rect width="32" height="32" rx="7" fill="#0B1F44" />
      <path d="M5.5 22.5H11" stroke="#E5564F" strokeWidth={3.4} strokeLinecap="round" />
      <path d="M5.5 16H15.5" stroke="#F2A93B" strokeWidth={3.4} strokeLinecap="round" />
      <rect x="14.25" y="5" width="3.5" height="22" rx="1.75" fill="#FFFFFF" />
      <path d="M5.5 9.5H26.5" stroke="#3DBB7E" strokeWidth={3.4} strokeLinecap="round" />
    </svg>
  );
}
