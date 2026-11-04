import { describe, expect, it } from 'vitest';
import { SHOP_CATALOGUE } from './shop/catalogue';
import { invoiceBody, SHOWCASE_CUSTOMERS, seededRandom, showcasePlan } from './showcase-seed';

const today = new Date('2026-11-04T12:00:00Z');
const plan = showcasePlan({ today, random: seededRandom(7) });

describe('showcasePlan', () => {
  it('spreads invoices over the last six months, never after today', () => {
    const dates = plan.invoices.map((i) => i.invoiceDate);
    expect(dates.every((d) => d <= '2026-11-04' && d >= '2026-05-06')).toBe(true);
    expect(new Set(dates.map((d) => d.slice(0, 7))).size).toBeGreaterThanOrEqual(5);
  });

  it('bills many customers, businesses and individuals, and every catalogue product', () => {
    const emails = new Set(plan.invoices.map((i) => i.customer.email));
    expect(emails.size).toBeGreaterThanOrEqual(10);
    expect(plan.invoices.some((i) => i.customer.company)).toBe(true);
    expect(plan.invoices.some((i) => !i.customer.company)).toBe(true);
    const billed = new Set(plan.invoices.flatMap((i) => i.items.map((item) => item.name)));
    expect(billed).toEqual(new Set(SHOP_CATALOGUE.items.map((p) => p.name)));
  });

  it('mixes paid, partly paid, overdue and open invoices', () => {
    const outcomes = new Set(plan.invoices.map((i) => i.outcome));
    for (const outcome of ['paid', 'partial', 'overdue', 'open']) expect(outcomes).toContain(outcome);
  });

  it('dates each payment between the invoice and today, and pays only part of a partly paid one', () => {
    for (const invoice of plan.invoices) {
      if (invoice.outcome === 'paid' || invoice.outcome === 'partial') {
        expect(invoice.payment!.date >= invoice.invoiceDate && invoice.payment!.date <= '2026-11-04').toBe(true);
        if (invoice.outcome === 'paid') expect(invoice.payment!.share).toBe(1);
        else expect(invoice.payment!.share).toBeLessThan(1);
      } else {
        expect(invoice.payment).toBeUndefined();
      }
    }
  });

  it('leaves overdue only invoices whose due date has passed', () => {
    for (const invoice of plan.invoices.filter((i) => i.outcome === 'overdue')) expect(invoice.dueDate < '2026-11-04').toBe(true);
  });

  it('charges catalogue prices to individual customers on the card', () => {
    const individuals = new Set(SHOWCASE_CUSTOMERS.filter((c) => !c.company).map((c) => c.email));
    expect(plan.charges).toHaveLength(16);
    for (const charge of plan.charges) {
      expect(individuals).toContain(charge.customerEmail);
      expect(SHOP_CATALOGUE.items.find((p) => p.name === charge.product)?.priceMinor).toBe(Math.round(Number(charge.value) * 100));
    }
  });

  it('is the same plan for the same seed', () => {
    expect(showcasePlan({ today, random: seededRandom(7) })).toEqual(plan);
  });
});

describe('invoiceBody', () => {
  it('writes the recipient, dates, lines with VAT and discount, and partial payment only when planned', () => {
    const body = invoiceBody({
      customer: { givenName: 'Giulia', surname: 'Rossi', email: 'giulia@trattoriarossi.example', company: 'Trattoria Rossi', country: 'IT' },
      invoiceDate: '2026-09-01',
      dueDate: '2026-10-01',
      items: [{ name: 'Linen tablecloth', quantity: 4, unitValue: '120.00', discountPercent: 10, taxPercent: 22 }],
      outcome: 'partial',
      payment: { date: '2026-09-10', method: 'BANK_TRANSFER', share: 0.5 },
    });

    expect(body).toEqual({
      detail: { currency_code: 'USD', invoice_date: '2026-09-01', payment_term: { due_date: '2026-10-01' }, note: 'Thank you for your order.' },
      primary_recipients: [
        { billing_info: { name: { given_name: 'Giulia', surname: 'Rossi' }, email_address: 'giulia@trattoriarossi.example', business_name: 'Trattoria Rossi' } },
      ],
      items: [
        {
          name: 'Linen tablecloth',
          quantity: '4',
          unit_amount: { currency_code: 'USD', value: '120.00' },
          unit_of_measure: 'QUANTITY',
          discount: { percent: '10' },
          tax: { name: 'VAT', percent: '22' },
        },
      ],
      configuration: { allow_partial_payment: true },
    });
  });
});

describe('seededRandom', () => {
  it('starts evenly even from a small seed', () => {
    for (const seed of [1, 2, 3]) {
      const random = seededRandom(seed);
      const first = Array.from({ length: 20 }, random);
      expect(first.some((x) => x > 0.5)).toBe(true);
      expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
    }
  });
});
