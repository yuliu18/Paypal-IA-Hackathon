// Notifies every configured channel at once. Each runs on its own: one that fails, throws or hangs
// never keeps the others from being told, and the guard is never held up past `timeoutMs`.

import type { HeldNotifier } from '../ports';

export function allNotifiers(notifiers: HeldNotifier[], { timeoutMs = 10_000 }: { timeoutMs?: number } = {}): HeldNotifier {
  return {
    async notifyHeld(entry) {
      // A notifier that throws before returning a promise counts as a rejected one.
      const sent = Promise.allSettled(notifiers.map(async (notifier) => notifier.notifyHeld(entry)));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      await Promise.race([sent, late]).finally(() => clearTimeout(timer));
    },
  };
}
