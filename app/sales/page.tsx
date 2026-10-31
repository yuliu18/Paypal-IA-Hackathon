import type { Metadata } from 'next';
import { SalesDesk, type CheckoutNotice } from './sales-desk';
import { SALES_SCENARIOS } from './scenarios';

export const metadata: Metadata = { title: 'Sales agent' };

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined);

// What happened at PayPal's checkout, from the query the return route (app/api/sales/paypal-return)
// or PayPal's cancel link sends the buyer back with.
function noticeOf(query: Record<string, string | string[] | undefined>): CheckoutNotice | undefined {
  const paid = one(query.paid);
  if (paid === 'ok') return { tone: 'ok', text: `Payment captured: order ${one(query.order) ?? ''} for ${one(query.amount) ?? 'its total'}. Thank you!` };
  if (paid === 'failed') return { tone: 'error', text: 'The payment could not be captured: the order is not one the shop recorded, or it is not approved. Details are in the server log.' };
  if (one(query.order) === 'cancelled') return { tone: 'muted', text: 'Payment cancelled on PayPal: nothing was charged.' };
  return undefined;
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SalesDesk scenarios={SALES_SCENARIOS} notice={noticeOf(await searchParams)} />;
}
