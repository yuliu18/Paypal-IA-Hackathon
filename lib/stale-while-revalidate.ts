// Keeps the last result of a slow load. While it is younger than `freshMs` it is the answer; once
// older, it is still answered at once and a new load starts in the background, so only the very
// first caller waits. One load runs at a time. A failed background load keeps the old result (and
// is reported to `onError`); a failed first load throws, and the next call tries again.
export function staleWhileRevalidate<T>(
  load: () => Promise<T>,
  freshMs: number,
  now: () => number = Date.now,
  onError: (error: unknown) => void = (error) => console.error('Background refresh failed', error),
): () => Promise<T> {
  let last: { value: T; at: number } | undefined;
  let pending: Promise<T> | undefined;

  const refresh = () =>
    (pending ??= load()
      .then((value) => {
        last = { value, at: now() };
        return value;
      })
      .finally(() => {
        pending = undefined;
      }));

  return async () => {
    if (!last) return refresh();
    if (now() - last.at >= freshMs) refresh().catch(onError);
    return last.value;
  };
}
