import type { AuditEntry } from '@/lib/guard/ports';

type Step = { result: string; isError?: boolean };

// What the guard did with one tool call of an agent, read from the result the guard gave the agent
// (lib/guard/guard.ts): "Blocked by payment guard. …" for a block, "<Action> held for human
// approval; …" for a hold. Any other error is PayPal's answer to a call the guard let through.
export function stepOutcome(step: Step): AuditEntry['outcome'] {
  if (step.isError) return step.result.startsWith('Blocked by payment guard.') ? 'blocked' : 'error';
  return /^[A-Z][a-z]*( [a-z]+)* held for human approval;/.test(step.result) ? 'held' : 'executed';
}
