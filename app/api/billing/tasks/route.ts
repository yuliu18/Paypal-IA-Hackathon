import { handleBillingTask } from '@/lib/agent/handle-billing-task';
import { TicketLimiter } from '@/lib/agent/ticket-limiter';
import { clientAddress } from '@/lib/auth/failed-attempts';
import { requestEnvironment } from '@/lib/settings/live-mode';

// Runs the demo billing agent on one task: bill this customer for this. Every PayPal call it makes
// goes through the payment guard (lib/guard/guard.ts), and each decision lands in the guard log at
// /guard. `agent: "vulnerable"` runs an agent that obeys the task text, to show what the guard stops.

const MAX_MESSAGE_LENGTH = 4_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Each task spends LLM tokens before the guard sees anything, so a client gets 20 tasks per 10
// minutes, 2 at a time, and 4 run at once across all clients, as for support tickets. The client is
// its address: the email in the body is whatever the sender typed.
const tasks = new TicketLimiter({ perClient: 20, windowMs: 10 * 60_000, inFlightPerClient: 2, inFlight: 4 });

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

  // Live PayPal (real money) only for an API-key request while live mode is really on
  // (lib/settings/live-mode.ts); the test pages, with the owner's session, always get the sandbox.
  let environment: Awaited<ReturnType<typeof requestEnvironment>>;
  try {
    environment = await requestEnvironment(request.headers);
  } catch (cause) {
    console.error('The PayPal environment could not be decided', cause);
    return error(502, 'The settings could not be read. Try again in a moment.');
  }
  // The vulnerable agent is a demonstration: it never runs with real money.
  if (environment === 'live' && agent === 'vulnerable') return error(400, 'agent "vulnerable" runs only on the PayPal sandbox, never in live mode.');

  const slot = tasks.acquire(clientAddress(request.headers), Date.now());
  if (!slot.ok) {
    const seconds = Math.ceil(slot.retryAfterMs / 1000);
    const message =
      slot.reason === 'quota'
        ? `Too many billing tasks from this address. Try again in ${seconds} seconds.`
        : 'The billing agent is busy with other tasks. Try again in a few seconds.';
    return error(429, message, { 'Retry-After': String(seconds) });
  }

  try {
    // `environment` tells the caller whether real money could move (live) or only test money.
    return Response.json({ ...(await handleBillingTask({ customerEmail, message }, agent, { environment })), environment });
  } catch (cause) {
    // The cause can carry provider responses or configuration names, so it stays in the server log.
    console.error('Billing agent failed', cause);
    return error(502, 'The billing agent failed. Details are in the server log.');
  } finally {
    slot.release();
  }
}
