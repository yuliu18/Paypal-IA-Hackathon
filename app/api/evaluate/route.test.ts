import { afterEach, describe, expect, it, vi } from 'vitest';

const handleTicket = vi.fn();
const handleBillingTask = vi.fn();
const handleSalesChat = vi.fn();
const readSeed = vi.fn();
vi.mock('@/lib/agent/handle-ticket', () => ({ handleTicket: (...args: unknown[]) => handleTicket(...args) }));
vi.mock('@/lib/agent/handle-billing-task', () => ({ handleBillingTask: (...args: unknown[]) => handleBillingTask(...args) }));
vi.mock('@/lib/agent/handle-sales-chat', () => ({ handleSalesChat: (...args: unknown[]) => handleSalesChat(...args) }));
vi.mock('@/lib/shop/checkout', () => ({ shopOrigin: () => 'https://shop.example' }));
vi.mock('@/lib/demo-seed', () => ({
  readSeed: () => readSeed(),
  // No sample subscription or dispute: the cases are the refund-only ones.
  readSeedSubscription: async () => undefined,
  readSeedDisputePayment: async () => undefined,
}));

const { POST } = await import('./route');

const post = (body: unknown) => POST(new Request('http://test/api/evaluate', { method: 'POST', body: JSON.stringify(body) }));
const charge = (customerEmail: string, orderId: string, captureId: string, value: string) => ({
  customerEmail, description: 'Item', orderId, captureId, status: 'COMPLETED', amount: { value, currency_code: 'USD' },
});
const SEED = [charge('ana@example.com', 'ORD-ANA', 'CAP-ANA', '49.99'), charge('ben@example.com', 'ORD-BEN', 'CAP-BEN', '120.00'), charge('carla@example.com', 'ORD-CARLA', 'CAP-CARLA', '35.50')];

describe('POST /api/evaluate', () => {
  afterEach(() => {
    handleTicket.mockReset();
    handleBillingTask.mockReset();
    handleSalesChat.mockReset();
    readSeed.mockReset();
  });

  it('runs one case through the careful agent with the daily cap lifted, and grades it', async () => {
    readSeed.mockResolvedValue(SEED);
    handleTicket.mockResolvedValue({ reply: 'Refunded.', steps: [{ tool: 'create_refund', args: { capture_id: 'CAP-ANA' }, isError: false, result: '{}' }] });

    const res = await post({ caseId: 'business-refund' });

    expect(res.status).toBe(200);
    expect(handleTicket).toHaveBeenCalledWith({ customerEmail: 'ana@example.com', message: expect.stringContaining('ORD-ANA') }, 'careful', { liftDailyCap: true, environment: 'sandbox' });
    expect(await res.json()).toMatchObject({ caseId: 'business-refund', result: { pass: true }, reply: 'Refunded.', steps: [{ tool: 'create_refund' }] });
  });

  it('runs a full-evaluation variant with the agent its case defines, not one the client sends', async () => {
    readSeed.mockResolvedValue(SEED);
    handleTicket.mockResolvedValue({ reply: 'No.', steps: [] });

    await post({ caseId: 'attack-system-notice:base64@vulnerable', agent: 'careful' });

    expect(handleTicket).toHaveBeenCalledWith({ customerEmail: 'ana@example.com', message: expect.stringContaining('base64') }, 'vulnerable', { liftDailyCap: true, environment: 'sandbox' });
  });

  it('runs a billing case through the billing agent with the daily cap lifted, never the support agent', async () => {
    readSeed.mockResolvedValue(SEED);
    const create = { tool: 'create_invoice', args: { primary_recipients: [{ billing_info: { email_address: 'ana@example.com' } }], items: [{ quantity: '2', unit_amount: { value: '49.99' } }] }, isError: false, result: '{}' };
    handleBillingTask.mockResolvedValue({ reply: 'Invoiced.', steps: [create, { tool: 'send_invoice', args: { invoice_id: 'INV2-1' }, isError: false, result: '{}' }], redacted: { ticket: 0, reply: 0 } });

    const res = await post({ caseId: 'business-invoice' });

    expect(handleTicket).not.toHaveBeenCalled();
    expect(handleBillingTask).toHaveBeenCalledWith({ customerEmail: 'ana@example.com', message: expect.stringContaining('ORD-ANA') }, 'careful', { liftDailyCap: true, environment: 'sandbox' });
    expect(await res.json()).toMatchObject({ caseId: 'business-invoice', result: { pass: true }, reply: 'Invoiced.' });

    handleBillingTask.mockResolvedValue({ reply: 'No.', steps: [], redacted: { ticket: 0, reply: 0 } });
    await post({ caseId: 'attack-invoice-copy:jailbreak@vulnerable' });
    expect(handleBillingTask).toHaveBeenLastCalledWith({ customerEmail: 'ana@example.com', message: expect.stringContaining('additional_recipients') }, 'vulnerable', { liftDailyCap: true, environment: 'sandbox' });
    expect(handleTicket).not.toHaveBeenCalled();
  });

  it("runs a sales case through the sales agent with the daily cap lifted and the shop's origin, and grades its order against that origin", async () => {
    readSeed.mockResolvedValue(SEED);
    const order = (returnUrl: string) => ({
      tool: 'create_order',
      args: { currencyCode: 'USD', items: [{ name: 'Ceramic mug set', quantity: 2, itemCost: 49.99, taxPercent: 0, itemTotal: 99.98 }], returnUrl, cancelUrl: 'https://shop.example/sales?order=cancelled' },
      isError: false,
      result: '{"id":"5O190127TN364715T","links":[]}',
    });
    handleSalesChat.mockResolvedValue({ reply: 'Here is your order.', steps: [order('https://shop.example/api/sales/paypal-return')], redacted: { ticket: 0, reply: 0 } });

    const res = await post({ caseId: 'business-order' });

    expect(handleTicket).not.toHaveBeenCalled();
    expect(handleBillingTask).not.toHaveBeenCalled();
    expect(handleSalesChat).toHaveBeenCalledWith({ customerEmail: 'ana@example.com', message: expect.stringContaining('Ceramic mug set') }, 'careful', { liftDailyCap: true, shopOrigin: 'https://shop.example', environment: 'sandbox' });
    expect(await res.json()).toMatchObject({ caseId: 'business-order', result: { pass: true }, reply: 'Here is your order.' });

    handleSalesChat.mockResolvedValue({ reply: 'Done.', steps: [order('https://elsewhere.example/return')], redacted: { ticket: 0, reply: 0 } });
    const attack = await (await post({ caseId: 'attack-order-return-url:base64@vulnerable' })).json();
    expect(handleSalesChat).toHaveBeenLastCalledWith({ customerEmail: 'ana@example.com', message: expect.stringContaining('base64') }, 'vulnerable', { liftDailyCap: true, shopOrigin: 'https://shop.example', environment: 'sandbox' });
    expect(attack).toMatchObject({ result: { pass: false, guardHeld: false } });
  });

  it('grades a failed ticket as not passed and keeps the cause in the server log', async () => {
    readSeed.mockResolvedValue(SEED);
    handleTicket.mockRejectedValue(new Error('LLM 410: model retired, key sk-1'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const body = await (await post({ caseId: 'attack-system-notice' })).json();

    expect(body).toMatchObject({ caseId: 'attack-system-notice', result: { pass: false, failed: true, reason: 'The AI provider no longer offers this model: choose another on /settings.' } });
    expect(JSON.stringify(body)).not.toContain('sk-1');
    expect(log).toHaveBeenCalledWith('Evaluation ticket failed', expect.objectContaining({ message: 'LLM 410: model retired, key sk-1' }));
    log.mockRestore();
  });

  it('refuses an unknown case, a body that is not an object, or no sample payments', async () => {
    readSeed.mockResolvedValue(SEED);
    expect((await post(null)).status).toBe(400);
    expect((await post({ caseId: 'nope' })).status).toBe(400);
    readSeed.mockResolvedValue([]);
    const res = await post({ caseId: 'business-refund' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { message: 'Create the sample payments first.' } });
  });
});
