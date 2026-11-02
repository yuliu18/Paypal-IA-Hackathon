import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { auditLog } from '@/lib/guard/runtime';
import { liveModeStatus } from '@/lib/settings/live-mode';
import { loadSettings } from '@/lib/settings/settings';
import { checkoutEnvironment, confirmedSale } from '@/lib/shop/checkout';
import { BrandMark } from '../ui/brand-mark';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('desks'))('checkout.title') };
}

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined);

const TONE = {
  ok: 'border-pp-success/40 bg-pp-success-tint text-pp-success',
  error: 'border-pp-danger/40 bg-pp-danger-tint text-pp-danger',
  muted: 'border-pp-border bg-pp-canvas text-pp-muted',
};

// What the guard's log and PayPal say about the returning buyer's order; undefined when either
// can't be read, so the page confirms nothing rather than failing.
async function lookUp(orderId: string) {
  try {
    const log = auditLog();
    const environment = await checkoutEnvironment(orderId, log, { liveActive: liveModeStatus(await loadSettings()).active });
    return await confirmedSale(orderId, log, { environment });
  } catch (error) {
    console.error('The checkout result could not be looked up', error);
    return undefined;
  }
}

// Where a buyer lands after PayPal's checkout (the capture route app/api/sales/paypal-return, or
// PayPal's cancel link). Public, with no side menu: buyers never sign in to the shop's guard. A
// payment is confirmed only from the guard's log and PayPal (lib/shop/checkout.ts confirmedSale),
// never from the link, which anyone can write; the link's words only ever say "failed" or
// "cancelled", which confirm nothing.
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const query = await searchParams;
  const t = await getTranslations('desks');
  const order = one(query.order);
  const sale = order && order !== 'cancelled' ? await lookUp(order) : undefined;
  const notice = sale
    ? { tone: 'ok' as const, text: t('sales.notices.paid', { order: sale.orderId, hasAmount: 'yes', amount: sale.amount }) }
    : one(query.paid) === 'failed'
      ? { tone: 'error' as const, text: t('sales.notices.failed') }
      : order === 'cancelled'
        ? { tone: 'muted' as const, text: t('sales.notices.cancelled') }
        : order
          ? { tone: 'muted' as const, text: t('checkout.unconfirmed') }
          : { tone: 'muted' as const, text: t('checkout.none') };
  return (
    <main className="flex min-h-full items-center justify-center px-6 py-12 font-paypal text-pp-ink">
      <section className="w-full max-w-md rounded-lg border border-pp-border bg-pp-surface p-8">
        <BrandMark className="size-8" />
        <h1 className="mt-4 text-2xl font-semibold">{t('checkout.title')}</h1>
        <p className={`mt-4 rounded-md border px-4 py-3 text-sm font-semibold ${TONE[notice.tone]}`}>{notice.text}</p>
        <p className="mt-4 text-sm text-pp-muted">{t('checkout.close')}</p>
      </section>
    </main>
  );
}
