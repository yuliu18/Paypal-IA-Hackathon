import type { NextRequest } from 'next/server';
import { completeSampleDisputePayment } from '@/lib/demo-dispute-payment';

// Where PayPal sends the sandbox buyer after paying the sample PayPal payment (?token=<order id>).
// Captures that one order with the buyer as its customer, then goes back to /support. Behind the
// demo password like every route (proxy.ts).
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('token') ?? '';
  const back = new URL('/support', request.url);
  try {
    await completeSampleDisputePayment(orderId);
    back.searchParams.set('paid', 'ok');
  } catch (error) {
    // Details stay in the server log, as in the other demo actions.
    console.error('Sample PayPal payment could not be completed', error);
    back.searchParams.set('paid', 'failed');
  }
  return Response.redirect(back, 303);
}
