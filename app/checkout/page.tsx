import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
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

// Where a buyer lands after PayPal's checkout (the capture route app/api/sales/paypal-return, or
// PayPal's cancel link). Public, with no side menu: buyers never sign in to the shop's guard. It
// only reads the query; the capture already happened, or didn't, on the server.
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const t = await getTranslations('desks');
  const paid = one(query.paid);
  const amount = one(query.amount);
  const notice =
    paid === 'ok'
      ? { tone: 'ok' as const, text: t('sales.notices.paid', { order: one(query.order) ?? '', hasAmount: amount === undefined ? 'no' : 'yes', amount: amount ?? '' }) }
      : paid === 'failed'
        ? { tone: 'error' as const, text: t('sales.notices.failed') }
        : one(query.order) === 'cancelled'
          ? { tone: 'muted' as const, text: t('sales.notices.cancelled') }
          : { tone: 'muted' as const, text: t('checkout.none') };
  return (
    <main className="flex min-h-full items-center justify-center px-6 py-12 font-paypal text-pp-ink">
      <section className="w-full max-w-md rounded-lg border border-pp-border bg-pp-surface p-8">
        <BrandMark className="size-8" />
        <h1 className="mt-4 text-2xl font-semibold">{t('checkout.title')}</h1>
        <p className={`mt-4 rounded-md border px-4 py-3 text-sm font-semibold ${TONE[notice.tone]}`}>{notice.text}</p>
        <p className="mt-4 text-sm text-pp-muted">{t('checkout.close')}</p>
        <Link href="/sales" className="mt-6 inline-block text-sm font-semibold text-pp-blue hover:underline">
          {t('checkout.back')}
        </Link>
      </section>
    </main>
  );
}
