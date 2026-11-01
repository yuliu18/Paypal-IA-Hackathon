import { describe, expect, it, vi } from 'vitest';
import { staleWhileRevalidate } from './stale-while-revalidate';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('staleWhileRevalidate', () => {
  it('waits for the first load, then answers from it while it is fresh', async () => {
    let clock = 0;
    const load = vi.fn(async () => `snapshot ${load.mock.calls.length}`);
    const get = staleWhileRevalidate(load, 30_000, () => clock);
    expect(await get()).toBe('snapshot 1');
    clock = 29_999;
    expect(await get()).toBe('snapshot 1');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('answers at once with the old snapshot once it is stale, and loads a new one in the background', async () => {
    let clock = 0;
    const next = deferred<string>();
    const load = vi.fn().mockResolvedValueOnce('old').mockReturnValueOnce(next.promise);
    const get = staleWhileRevalidate(load, 30_000, () => clock);
    await get();
    clock = 30_000;
    expect(await get()).toBe('old');
    expect(load).toHaveBeenCalledTimes(2);
    next.resolve('new');
    await next.promise;
    expect(await get()).toBe('new');
  });

  it('starts one load at a time, however many visits arrive while it runs', async () => {
    const first = deferred<string>();
    const load = vi.fn(() => first.promise);
    const get = staleWhileRevalidate(load, 30_000, () => 0);
    const visits = [get(), get(), get()];
    first.resolve('one');
    expect(await Promise.all(visits)).toEqual(['one', 'one', 'one']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the old snapshot when a background load fails', async () => {
    let clock = 0;
    const load = vi.fn().mockRejectedValue(new Error('PayPal down')).mockResolvedValueOnce('old');
    const onError = vi.fn();
    const get = staleWhileRevalidate(load, 30_000, () => clock, onError);
    await get();
    clock = 60_000;
    expect(await get()).toBe('old');
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(await get()).toBe('old');
  });

  it('throws when the first load fails, and the next visit tries again', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('PayPal down')).mockResolvedValueOnce('ok');
    const get = staleWhileRevalidate(load, 30_000, () => 0);
    await expect(get()).rejects.toThrow('PayPal down');
    expect(await get()).toBe('ok');
  });
});
