import type { NextRequest } from 'next/server';
import { completeSampleDisputePayment } from '@/lib/demo-dispute-payment';
import { relativeRedirect } from '@/lib/http/redirect';

// Where PayPal sends the sandbox buyer after paying the sample PayPal payment (?token=<order id>).
// Captures that one order with the buyer as its customer, then goes back to /support. Open without
// signing in, like its result page: the buyer never signs in (lib/auth/access.ts).
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('token') ?? '';
  let paid = 'ok';
  try {
    await completeSampleDisputePayment(orderId);
  } catch (error) {
    // Details stay in the server log, as in the other demo actions.
    console.error('Sample PayPal payment could not be completed', error);
    paid = 'failed';
  }
  return relativeRedirect(`/support?paid=${paid}`, 303);
}
