// InvoiceLookup backed by the PayPal REST API: an invoice gives its status, its total and whom it
// bills. One bounded GET, no retries: the guard fails closed on any error.

import { accessToken, PAYPAL_API } from '@/lib/paypal';
import { toMinor } from './paypal-capture-lookup';
import type { InvoiceFacts } from '../domain/invoice';
import type { Money } from '../domain/policy';
import type { InvoiceLookup } from '../ports';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function totalOf(amount: unknown): Money | null {
  if (!isRecord(amount) || typeof amount.value !== 'string' || typeof amount.currency_code !== 'string') return null;
  try {
    return toMinor({ value: amount.value, currency_code: amount.currency_code });
  } catch {
    return null;
  }
}

// Each recipient's billing email, or '' when it has none, so a recipient is never silently dropped.
export function toInvoiceFacts(body: unknown): InvoiceFacts {
  if (!isRecord(body) || typeof body.id !== 'string' || typeof body.status !== 'string') throw new Error('Unreadable PayPal invoice');
  const recipients = Array.isArray(body.primary_recipients) ? body.primary_recipients : [];
  const recipientEmails = recipients.map((recipient) => {
    const billing = isRecord(recipient) ? recipient.billing_info : undefined;
    return isRecord(billing) && typeof billing.email_address === 'string' ? billing.email_address : '';
  });
  return { id: body.id, status: body.status, amount: totalOf(body.amount), recipientEmails };
}

export function createPayPalInvoiceLookup({
  fetch = globalThis.fetch,
  token = accessToken,
  timeoutMs = 10_000,
}: { fetch?: typeof globalThis.fetch; token?: () => Promise<string>; timeoutMs?: number } = {}): InvoiceLookup {
  return {
    async getInvoice(invoiceId) {
      const path = `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`;
      const res = await fetch(`${PAYPAL_API}${path}`, {
        headers: { Authorization: `Bearer ${await token()}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`PayPal ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
      return toInvoiceFacts(await res.json());
    },
  };
}

export const payPalInvoiceLookup = createPayPalInvoiceLookup();
