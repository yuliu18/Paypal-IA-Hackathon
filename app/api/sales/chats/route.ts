import { handleSalesChat } from '@/lib/agent/handle-sales-chat';
import { TicketLimiter } from '@/lib/agent/ticket-limiter';
import { clientAddress } from '@/lib/demo-auth';
import { shopOrigin } from '@/lib/shop/checkout';

// Runs the demo sales agent on one customer message: the customer who writes wants to buy from the
// catalogue. Every PayPal call it makes goes through the payment guard (lib/guard/guard.ts), and
// each decision lands in the guard log at /guard. `agent: "vulnerable"` runs an agent that obeys
// the message, to show what the guard stops.

const MAX_MESSAGE_LENGTH = 4_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Each chat spends LLM tokens before the guard sees anything, so a client gets 20 chats per 10
// minutes, 2 at a time, and 4 run at once across all clients, as for the other agents. The client
// is its address: the email in the body is whatever the sender typed.
const chats = new TicketLimiter({ perClient: 20, windowMs: 10 * 60_000, inFlightPerClient: 2, inFlight: 4 });

const error = (status: number, message: string, headers?: HeadersInit) => Response.json({ error: { message } }, { status, headers });

export async function POST(request: Request) {
  let body: { customerEmail?: unknown; message?: unknown; agent?: unknown };
  try {
    body = await request.json();
  } catch {
    return error(400, 'Request body must be JSON.');
  }
  if (!body || typeof body !== 'object') return error(400, 'Request body must be a JSON object.');

  const { customerEmail, message, agent = 'careful' } = body;
  if (typeof customerEmail !== 'string' || !EMAIL.test(customerEmail)) return error(400, 'customerEmail must be an email address.');
  if (typeof message !== 'string' || !message.trim()) return error(400, 'message must be a non-empty string.');
  if (message.length > MAX_MESSAGE_LENGTH) return error(400, `message must be at most ${MAX_MESSAGE_LENGTH} characters.`);
  if (agent !== 'careful' && agent !== 'vulnerable') return error(400, 'agent must be "careful" or "vulnerable".');

  const slot = chats.acquire(clientAddress(request.headers), Date.now());
  if (!slot.ok) {
    const seconds = Math.ceil(slot.retryAfterMs / 1000);
    const message =
      slot.reason === 'quota'
        ? `Too many sales chats from this address. Try again in ${seconds} seconds.`
        : 'The sales agent is busy with other chats. Try again in a few seconds.';
    return error(429, message, { 'Retry-After': String(seconds) });
  }

  try {
    // The buyer comes back to the app they started from (this request's origin), else APP_URL.
    return Response.json(await handleSalesChat({ customerEmail, message }, agent, { shopOrigin: shopOrigin(request.headers.get('origin')) }));
  } catch (cause) {
    // The cause can carry provider responses or configuration names, so it stays in the server log.
    console.error('Sales agent failed', cause);
    return error(502, 'The sales agent failed. Details are in the server log.');
  } finally {
    slot.release();
  }
}
