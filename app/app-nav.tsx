'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The control panel's side menu, on every page: the agent and its guard first, then the reports,
// the raw PayPal data and the settings. Collapses to a scrolling top bar on small screens.

const icon = 'size-4 shrink-0';
const Icons = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  shield: <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" />,
  chart: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  table: <path d="M3 5h18v14H3zM3 10h18M9 10v9" />,
  gear: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-5v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" />,
};

type Item = { href: string; label: string; icon: keyof typeof Icons };
const SECTIONS: { title?: string; items: Item[] }[] = [
  { items: [{ href: '/', label: 'Overview', icon: 'home' }] },
  {
    title: 'Agent',
    items: [
      { href: '/support', label: 'Support desk', icon: 'chat' },
      { href: '/guard', label: 'Guard log', icon: 'shield' },
    ],
  },
  { title: 'Insights', items: [{ href: '/dashboard', label: 'Dashboard', icon: 'chart' }] },
  {
    title: 'PayPal data',
    items: [
      { href: '/transactions', label: 'Transactions', icon: 'table' },
      { href: '/balances', label: 'Balances', icon: 'table' },
      { href: '/invoices', label: 'Invoices', icon: 'table' },
      { href: '/products', label: 'Products', icon: 'table' },
      { href: '/plans', label: 'Billing plans', icon: 'table' },
    ],
  },
  { title: 'Setup', items: [{ href: '/settings', label: 'Settings', icon: 'gear' }] },
];

export function AppNav() {
  const pathname = usePathname();
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-pp-border bg-pp-navy px-3 py-2 font-paypal text-sm md:sticky md:top-0 md:h-dvh md:w-56 md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:px-3 md:py-5">
      <Link href="/" className="mr-3 flex shrink-0 items-center gap-2 px-2 font-semibold text-white md:mb-6 md:mr-0">
        <svg viewBox="0 0 24 24" className="size-6 fill-pp-sky" aria-hidden>
          {Icons.shield}
        </svg>
        <span className="leading-tight">
          Payment Guard
          <span className="hidden text-xs font-normal text-white/60 md:block">AI agents × PayPal</span>
        </span>
      </Link>
      {SECTIONS.map((section, index) => (
        <div key={index} className="flex shrink-0 gap-1 md:mb-4 md:flex-col">
          {section.title && <p className="hidden px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/50 md:block">{section.title}</p>}
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(item.href) ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2.5 rounded px-2 py-1.5 ${active(item.href) ? 'bg-white/15 font-semibold text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'}`}
            >
              <svg viewBox="0 0 24 24" className={`${icon} fill-none stroke-current`} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
                {Icons[item.icon]}
              </svg>
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
