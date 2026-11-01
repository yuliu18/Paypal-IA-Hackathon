import { describe, expect, it, vi } from 'vitest';
import { createOwnerLookup } from './owner';

describe('createOwnerLookup', () => {
  it('names the oldest account as the owner, and none before anyone signed up', async () => {
    const oldest = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('owner-1');
    const owner = createOwnerLookup(oldest, { ttlMs: 60_000, now: () => 0 });
    expect(await owner.ownerId()).toBeNull();
    expect(await owner.ownerId()).toBe('owner-1');
  });

  it('remembers the owner for a while, so a page view costs no database query', async () => {
    let now = 0;
    const oldest = vi.fn().mockResolvedValue('owner-1');
    const owner = createOwnerLookup(oldest, { ttlMs: 60_000, now: () => now });
    await owner.ownerId();
    now = 59_999;
    await owner.ownerId();
    expect(oldest).toHaveBeenCalledTimes(1);
    now = 60_000;
    await owner.ownerId();
    expect(oldest).toHaveBeenCalledTimes(2);
  });

  it('never remembers "no owner yet", so the set-up page closes as soon as the owner exists', async () => {
    const oldest = vi.fn().mockResolvedValue(null);
    const owner = createOwnerLookup(oldest, { ttlMs: 60_000, now: () => 0 });
    await owner.ownerId();
    await owner.ownerId();
    expect(oldest).toHaveBeenCalledTimes(2);
  });

  it('asks the database again when told to, after the owner account was created', async () => {
    const oldest = vi.fn().mockResolvedValueOnce('owner-1').mockResolvedValueOnce('owner-2');
    const owner = createOwnerLookup(oldest, { ttlMs: 60_000, now: () => 0 });
    await owner.ownerId();
    owner.forget();
    expect(await owner.ownerId()).toBe('owner-2');
  });

  it('lets a database failure through, so callers fail closed', async () => {
    const owner = createOwnerLookup(() => Promise.reject(new Error('db down')), { ttlMs: 60_000, now: () => 0 });
    await expect(owner.ownerId()).rejects.toThrow('db down');
  });
});
