import type { NextRequest } from 'next/server';
import { auditLog } from '@/lib/guard/runtime';
import { relativeRedirect } from '@/lib/http/redirect';
import { liveModeStatus } from '@/lib/settings/live-mode';
import { loadSettings } from '@/lib/settings/settings';
import { CHECKOUT_RESULT_PATH, checkoutEnvironment, completeSalesOrder } from '@/lib/shop/checkout';

// Where PayPal sends the buyer after approving a sales agent's order (?token=<order id>). The shop
// captures that order here, server-side, only when the guard's audit log records creating and
// binding it to a customer and the buyer approved it, then shows the result on /checkout. Public
// (lib/auth/access.ts): the buyer coming back from PayPal never signs in to the shop's guard.
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('token') ?? '';
  const back = new URLSearchParams();
  try {
    // auditLog() inside the try: a log that can't be opened captures nothing (fails closed).
    const log = auditLog();
    // Live PayPal only for an order the guard created live, while live mode is on.
    const environment = await checkoutEnvironment(orderId, log, { liveActive: liveModeStatus(await loadSettings()).active });
    const sale = await completeSalesOrder(orderId, log, { environment });
    // Only the order id: /checkout asks the guard's log and PayPal whether it is paid, so a link
    // that merely says "paid" proves nothing.
    back.set('order', sale.orderId);
  } catch (error) {
    // Details stay in the server log, as in the other demo routes.
    console.error('Sales order could not be captured', error);
    back.set('paid', 'failed');
  }
  return relativeRedirect(`${CHECKOUT_RESULT_PATH}?${back}`, 303);
}
