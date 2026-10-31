'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { setNavSlot } from './nav-slot';
import { BrandMark } from './ui/brand-mark';

// The control panel's side menu, on every page, grouped by what the owner came to do: watch the
// guard, put the agents to work, test a model, set things up. On the dashboard, its reports and
// their pages appear under "Dashboard" (./nav-slot). The toggle beside the name, at the top, folds the menu into a rail of icons.
// On small screens it is a scrolling top bar.

const icon = 'size-4 shrink-0';
const Icons = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  invoice: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />,
  cart: <path d="M3 4h2l2.4 11h10.2L20 8H6.5M10 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01" />,
  shield: <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" />,
  chart: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  check: <path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />,
  collapse: <path d="M15 6l-6 6 6 6" />,
  expand: <path d="M9 6l6 6-6 6" />,
  gear: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-5v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" />,
};

// Labels are message keys under `nav` (messages/<locale>/nav.json).
type Item = { href: string; label: string; icon: keyof typeof Icons };
const SECTIONS: { title?: string; items: Item[] }[] = [
  {
    items: [
      { href: '/', label: 'items.overview', icon: 'home' },
      { href: '/guard', label: 'items.guard', icon: 'shield' },
      { href: '/dashboard', label: 'items.dashboard', icon: 'chart' },
    ],
  },
  {
    title: 'groups.agents',
    items: [
      { href: '/support', label: 'items.support', icon: 'chat' },
      { href: '/billing', label: 'items.billing', icon: 'invoice' },
      { href: '/sales', label: 'items.sales', icon: 'cart' },
    ],
  },
  {
    title: 'groups.setup',
    items: [
      { href: '/evaluate', label: 'items.evaluate', icon: 'check' },
      { href: '/settings', label: 'items.settings', icon: 'gear' },
    ],
  },
];

const Icon = ({ name }: { name: keyof typeof Icons }) => (
  <svg viewBox="0 0 24 24" className={`${icon} fill-none stroke-current`} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
    {Icons[name]}
  </svg>
);

export function AppNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const onDashboard = pathname.startsWith('/dashboard');
  // The owner's choice holds until they move between the dashboard and the other pages.
  const [choice, setChoice] = useState<{ onDashboard: boolean; compact: boolean }>();
  const compact = choice?.onDashboard === onDashboard ? choice.compact : false;
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  // Labels hide only from md up: the small-screen top bar always shows them.
  const label = compact ? 'md:sr-only' : '';
  return (
    <nav
      className={`flex shrink-0 gap-1 overflow-x-auto border-b border-pp-border bg-pp-surface px-3 py-2 font-paypal text-sm md:h-full md:flex-col md:overflow-y-auto [scrollbar-color:var(--pp-border)_transparent] [scrollbar-width:thin] md:border-r md:border-b-0 md:py-5 ${compact ? 'md:w-16 md:px-2' : 'md:w-60 md:px-3'}`}
    >
      <div className={`mr-3 flex shrink-0 items-center gap-2 md:mb-6 md:mr-0 ${compact ? 'md:flex-col' : ''}`}>
        <Link href="/" title="Payment Guard" className="flex min-w-0 items-center gap-2.5 px-2 font-semibold text-pp-ink">
          <BrandMark className="size-7" />
          <span className={`leading-tight ${label}`}>
            Payment Guard
            <span className="hidden text-xs font-normal text-pp-muted md:block">{t('tagline')}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setChoice({ onDashboard, compact: !compact })}
          title={compact ? t('expand') : t('collapse')}
          aria-label={compact ? t('expand') : t('collapse')}
          aria-expanded={!compact}
          className={`hidden size-8 shrink-0 items-center justify-center rounded-md text-pp-muted hover:bg-pp-canvas hover:text-pp-ink md:flex ${compact ? '' : 'ml-auto'}`}
        >
          <Icon name={compact ? 'expand' : 'collapse'} />
        </button>
      </div>
      {SECTIONS.map((section, index) => (
        <div key={index} className="flex shrink-0 gap-1 md:mb-4 md:flex-col">
          {section.title && (
            <p className={`hidden px-2 pb-1 text-xs font-medium text-pp-muted ${compact ? '' : 'md:block'}`}>{t(section.title)}</p>
          )}
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={compact ? t(item.label) : undefined}
              aria-current={active(item.href) ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2.5 rounded px-2 py-1.5 ${compact ? 'md:justify-center md:py-2' : ''} ${active(item.href) ? 'bg-pp-highlight font-semibold text-pp-blue' : 'text-pp-ink hover:bg-pp-canvas'}`}
            >
              <Icon name={item.icon} />
              <span className={label}>{t(item.label)}</span>
            </Link>
          ))}
          {section.items.some((item) => item.href === '/dashboard') && onDashboard && !compact && (
            <div ref={setNavSlot} className="hidden md:block" />
          )}
        </div>
      ))}
    </nav>
  );
}
