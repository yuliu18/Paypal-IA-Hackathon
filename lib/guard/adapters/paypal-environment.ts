// The guard's PayPal lookups and order binder for one request's environment (the sandbox or live),
// built per request so a live request's adapters never serve a sandbox one, or the other way round.

import type { PaymentEnvironment } from '@/lib/paypal';
import { createPayPalCaptureLookup, payPalCaptureLookup } from './paypal-capture-lookup';
import { createPayPalDisputeLookup, payPalDisputeLookup } from './paypal-dispute-lookup';
import { createPayPalInvoiceLookup, payPalInvoiceLookup } from './paypal-invoice-lookup';
import { createPayPalOrderBinder, payPalOrderBinder } from './paypal-order-binder';
import { createPayPalSubscriptionLookup, payPalSubscriptionLookup } from './paypal-subscription-lookup';

// The sandbox's are the shared defaults; anything but exactly 'live' gets them.
const SANDBOX = {
  captures: payPalCaptureLookup,
  subscriptions: payPalSubscriptionLookup,
  disputes: payPalDisputeLookup,
  invoices: payPalInvoiceLookup,
  binder: payPalOrderBinder,
};

export function payPalAdapters(environment: PaymentEnvironment) {
  if (environment !== 'live') return SANDBOX;
  return {
    captures: createPayPalCaptureLookup({ environment }),
    subscriptions: createPayPalSubscriptionLookup({ environment }),
    disputes: createPayPalDisputeLookup({ environment }),
    invoices: createPayPalInvoiceLookup({ environment }),
    binder: createPayPalOrderBinder({ environment }),
  };
}
