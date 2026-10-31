import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SalesDesk, type CheckoutNotice } from './sales-desk';
import { SALES_SCENARIOS } from './scenarios';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('desks'))('sales.title') };
}

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined);

// What happened at PayPal's checkout, from the query the return route (app/api/sales/paypal-return)
// or PayPal's cancel link sends the buyer back with.
async function noticeOf(query: Record<string, string | string[] | undefined>): Promise<CheckoutNotice | undefined> {
  const t = await getTranslations('desks.sales.notices');
  const paid = one(query.paid);
  const amount = one(query.amount);
  if (paid === 'ok') return { tone: 'ok', text: t('paid', { order: one(query.order) ?? '', hasAmount: amount === undefined ? 'no' : 'yes', amount: amount ?? '' }) };
  if (paid === 'failed') return { tone: 'error', text: t('failed') };
  if (one(query.order) === 'cancelled') return { tone: 'muted', text: t('cancelled') };
  return undefined;
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SalesDesk scenarios={SALES_SCENARIOS} notice={await noticeOf(await searchParams)} />;
}
