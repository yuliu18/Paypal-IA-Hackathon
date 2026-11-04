// The OpenAPI 3.1 description of what a shop's own app can call with an API key: the three agent
// endpoints (lib/auth/access.ts API_KEY_ROUTES). Served at /api/openapi and shown with Swagger UI on
// /api-docs. The request rules mirror the routes' own checks (app/api/{support,billing,sales}/.../route.ts).

const errorBody = (description: string, example: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: { message: example } } } },
});

const responses = (agent: string) => ({
  '200': {
    description: `The ${agent} agent finished. Every PayPal call it tried went through the payment guard; \`steps\` shows each one and the guard's answer.`,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentResult' } } },
  },
  '400': errorBody('The body is not valid (see the message), or `agent: "vulnerable"` was asked for while the request runs on live PayPal.', 'customerEmail must be an email address.'),
  '401': {
    description: 'No API key, or a wrong or revoked one.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' }, example: { error: 'Invalid or revoked API key.' } } },
  },
  '429': {
    ...errorBody('Too many requests from this client (20 per 10 minutes, 2 at a time), or the agent is busy (4 at once overall). Retry after `Retry-After` seconds.', 'Too many tickets from this address. Try again in 42 seconds.'),
    headers: { 'Retry-After': { description: 'Seconds to wait before trying again.', schema: { type: 'integer' } } },
  },
  '502': errorBody('The agent, the AI provider or the settings failed. Details stay in the server log.', 'The support agent failed. Details are in the server log.'),
});

const endpoint = (agent: string, summary: string, description: string, example: { customerEmail: string; message: string }) => ({
  post: {
    tags: ['Agents'],
    summary,
    description,
    security: [{ apiKey: [] }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentRequest' }, example } },
    },
    responses: responses(agent),
  },
});

const LIVE_NOTE =
  'Runs on live PayPal (real money) only while live mode is on in Settings and the server allows it (`ALLOW_LIVE_MODE=true`); otherwise on the sandbox. The guard log records which.';

export function openApiDocument(serverUrl?: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Payment Guard agent API',
      version: '1.0.0',
      description: [
        "Your shop's own app (a help desk, a checkout, a chat widget) sends a customer's message to one of the agents. The agent works on your PayPal account through the payment guard: deterministic limits and ownership checks, an intent judge that can only tighten, held actions for a person to approve, and a hash-chained audit log at /guard.",
        '',
        'Create an API key on the API page (/api-docs) and send it as `Authorization: Bearer pg_…`. A key opens these three endpoints and nothing else.',
        '',
        LIVE_NOTE,
      ].join('\n'),
    },
    servers: [{ url: serverUrl ?? '/' }],
    tags: [{ name: 'Agents', description: 'One customer message in, the agent’s reply and its guarded PayPal calls out.' }],
    paths: {
      '/api/support/tickets': endpoint(
        'support',
        'Send a support ticket',
        'The support agent can look up orders, refund captures, cancel subscriptions and accept dispute claims, but only for `customerEmail` and within your refund policy and limits.',
        { customerEmail: 'ana@example.com', message: 'My mug arrived broken, can I get my money back?' },
      ),
      '/api/billing/tasks': endpoint(
        'billing',
        'Send a billing task',
        'Here `message` is the shop’s billing task for `customerEmail`. The billing agent creates, sends and reminds invoices, only to customers the shop already sells to.',
        { customerEmail: 'ben@example.com', message: 'Invoice 2 extra mugs at 18.00 USD each, picked up in store.' },
      ),
      '/api/sales/chats': endpoint(
        'sales',
        'Send a sales chat message',
        'The sales agent answers from the catalogue and creates a PayPal order at catalogue prices; the reply carries the link where the buyer approves and pays.',
        { customerEmail: 'carla@example.com', message: 'I would like two ceramic mugs.' },
      ),
    },
    components: {
      securitySchemes: {
        apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'pg_ API key', description: 'Created on the API page (/api-docs); shown once.' },
      },
      schemas: {
        AgentRequest: {
          type: 'object',
          required: ['customerEmail', 'message'],
          properties: {
            customerEmail: {
              type: 'string',
              format: 'email',
              description: 'The customer the agent may act for. The guard refuses any PayPal action on someone else’s orders, subscriptions or invoices.',
            },
            message: {
              type: 'string',
              minLength: 1,
              maxLength: 4000,
              description: 'What the customer wrote. Treated as untrusted input, never as instructions; card numbers are masked before the agent sees it.',
            },
            agent: {
              type: 'string',
              enum: ['careful', 'vulnerable'],
              default: 'careful',
              description: '`vulnerable` obeys the message, to show what the guard stops. Sandbox only.',
            },
          },
        },
        AgentResult: {
          type: 'object',
          required: ['reply', 'steps', 'redacted', 'environment'],
          properties: {
            reply: {
              type: 'string',
              description: 'The text to show your customer: the agent’s answer, without other people’s data. For a sale it carries the PayPal link where the buyer pays.',
            },
            steps: {
              type: 'array',
              description: 'For your logs and support staff, not for the customer: each PayPal call the agent tried and what the guard answered. The same decisions are in the guard log at /guard.',
              items: { $ref: '#/components/schemas/AgentStep' },
            },
            environment: {
              type: 'string',
              enum: ['sandbox', 'live'],
              description: 'Where the PayPal calls ran: `live` moved real money, `sandbox` only test money. A key request runs on the sandbox whenever live mode is not fully on, so check this before telling a customer a refund or payment is real.',
            },
            redacted: {
              type: 'object',
              required: ['ticket', 'reply'],
              properties: {
                ticket: { type: 'integer', description: 'Card numbers masked in the message.' },
                reply: { type: 'integer', description: 'Card numbers or other emails masked in the reply.' },
              },
            },
          },
        },
        AgentStep: {
          type: 'object',
          required: ['tool', 'args', 'isError', 'result'],
          properties: {
            tool: { type: 'string', example: 'create_refund' },
            args: { type: 'object', additionalProperties: true },
            isError: { type: 'boolean', description: 'True when the guard blocked the call or PayPal refused it. A held call is not an error: its result says a person will review it in /guard.' },
            result: { type: 'string', description: 'What the agent saw: PayPal’s answer, or the guard’s reason (e.g. `Blocked by payment guard: CUSTOMER_MISMATCH …`).' },
          },
        },
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } } },
        },
        AuthError: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
      },
    },
  };
}
