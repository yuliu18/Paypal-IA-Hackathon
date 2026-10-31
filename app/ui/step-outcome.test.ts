import { describe, expect, it } from 'vitest';
import { stepOutcome } from './step-outcome';

const step = (result: string, isError = false) => ({ tool: 't', args: {}, result, isError });

describe('stepOutcome', () => {
  it('reads what the guard did from the tool result every agent gets', () => {
    expect(stepOutcome(step('{"id":"R1","status":"COMPLETED"}'))).toBe('executed');
    expect(stepOutcome(step('Blocked by payment guard. CUSTOMER_MISMATCH: …', true))).toBe('blocked');
    expect(stepOutcome(step('PayPal 422 on /v2/payments/captures/X/refund', true))).toBe('error');
  });

  it('knows every kind of held call, a dispute acceptance included', () => {
    for (const kind of ['Refund', 'Cancellation', 'Dispute acceptance', 'Invoice', 'Invoice sending', 'Invoice reminder', 'Order']) {
      expect(stepOutcome(step(`${kind} held for human approval; it has not been executed. APPROVAL_REQUIRED: x`))).toBe('held');
    }
  });

  it('does not take a PayPal answer that merely quotes the words for a hold', () => {
    expect(stepOutcome(step('{"note":"Refund held for human approval; it has not been executed."}'))).toBe('executed');
  });
});
