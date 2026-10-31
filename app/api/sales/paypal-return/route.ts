import type { NextRequest } from 'next/server';
import { auditLog } from '@/lib/guard/runtime';
import { completeSalesOrder } from '@/lib/shop/checkout';

// Where PayPal sends the buyer after approving a sales agent's order (?token=<order id>). The shop
// captures that order here, server-side, only when the guard's audit log records creating and
// binding it to a customer and the buyer approved it, then shows the confirmation on /sales. Behind the demo password like every route
// (proxy.ts).
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('token') ?? '';
  const back = new URL('/sales', request.url);
  try {
    // auditLog() inside the try: a log that can't be opened captures nothing (fails closed).
    const sale = await completeSalesOrder(orderId, auditLog());
    back.searchParams.set('paid', 'ok');
    back.searchParams.set('order', sale.orderId);
    back.searchParams.set('amount', sale.amount);
  } catch (error) {
    // Details stay in the server log, as in the other demo routes.
    console.error('Sales order could not be captured', error);
    back.searchParams.set('paid', 'failed');
  }
  return Response.redirect(back, 303);
}
