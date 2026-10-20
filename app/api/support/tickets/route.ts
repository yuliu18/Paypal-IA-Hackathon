import { handleTicket } from '@/lib/agent/handle-ticket';

// Runs the demo support agent on one ticket. Every PayPal call it makes goes through the payment
// guard (lib/guard/guard.ts), and each decision lands in the guard log at /guard. `agent:
// "vulnerable"` runs an agent that obeys the ticket, to show what the guard stops.

const MAX_MESSAGE_LENGTH = 4_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const error = (status: number, message: string) => Response.json({ error: { message } }, { status });

export async function POST(request: Request) {
  let body: { customerEmail?: unknown; message?: unknown; agent?: unknown };
  try {
    body = await request.json();
  } catch {
    return error(400, 'Request body must be JSON.');
  }

  const { customerEmail, message, agent = 'careful' } = body;
  if (typeof customerEmail !== 'string' || !EMAIL.test(customerEmail)) return error(400, 'customerEmail must be an email address.');
  if (typeof message !== 'string' || !message.trim()) return error(400, 'message must be a non-empty string.');
  if (message.length > MAX_MESSAGE_LENGTH) return error(400, `message must be at most ${MAX_MESSAGE_LENGTH} characters.`);
  if (agent !== 'careful' && agent !== 'vulnerable') return error(400, 'agent must be "careful" or "vulnerable".');

  try {
    return Response.json(await handleTicket({ customerEmail, message }, agent));
  } catch (cause) {
    console.error('Support agent failed', cause);
    return error(502, cause instanceof Error ? cause.message : 'The support agent failed.');
  }
}
