import { describe, expect, it } from 'vitest';
import type { AuditRow, HeldNotifier } from '../ports';
import { allNotifiers } from './all-notifiers';

const entry = { id: '42' } as AuditRow;

function recording(behaviour: () => Promise<void> = async () => undefined) {
  const calls: AuditRow[] = [];
  const notifier: HeldNotifier = {
    notifyHeld(row) {
      calls.push(row);
      return behaviour();
    },
  };
  return { notifier, calls };
}

describe('all notifiers', () => {
  it('notifies every channel with the same entry', async () => {
    const [a, b, c] = [recording(), recording(), recording()];
    await allNotifiers([a.notifier, b.notifier, c.notifier]).notifyHeld(entry);
    expect([a.calls, b.calls, c.calls]).toEqual([[entry], [entry], [entry]]);
  });

  it('still notifies the others when one channel rejects, throws or never answers, and resolves', async () => {
    const rejecting = recording(() => Promise.reject(new Error('down')));
    const throwing = recording(() => {
      throw new Error('sync');
    });
    const hanging = recording(() => new Promise<void>(() => undefined));
    const last = recording();
    const all = allNotifiers([rejecting.notifier, throwing.notifier, hanging.notifier, last.notifier], { timeoutMs: 20 });
    await expect(all.notifyHeld(entry)).resolves.toBeUndefined();
    expect([rejecting.calls, throwing.calls, hanging.calls, last.calls]).toEqual([[entry], [entry], [entry], [entry]]);
  });

  it('does nothing with no channels', async () => {
    await expect(allNotifiers([]).notifyHeld(entry)).resolves.toBeUndefined();
  });
});
