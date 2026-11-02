import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { localSession, startSession } from './local-session';
import { resetLocalOwnerPassword } from './owner-reset';
import { passwordProblems } from './password';
import { hashPassword, verifyPassword } from './scrypt';
import { createSqliteAuthStore } from './sqlite-auth-store';

const scratch = mkdtempSync(join(tmpdir(), 'owner-reset-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let files = 0;
const store = () => createSqliteAuthStore(join(scratch, `auth-${++files}.db`));
const page = (token: string) => new NextRequest('https://guard.example/guard', { headers: { cookie: `pg_session=${token}` } });

describe('npm run owner:reset', () => {
  it('sets a new random password that meets the rule, replaces the old one and ends every session', async () => {
    const s = store();
    await s.createOwner({ email: 'owner@shop.example', passwordHash: await hashPassword('Old-password-1') }, new Date());
    const tokens = [await startSession(s), await startSession(s)];
    const result = await resetLocalOwnerPassword(s);
    if (result.kind !== 'reset') throw new Error(`expected a reset, got ${result.kind}`);
    expect(result.email).toBe('owner@shop.example');
    expect(passwordProblems(result.password)).toEqual([]);
    const owner = (await s.owner())!;
    expect(await verifyPassword(result.password, owner.passwordHash)).toBe(true);
    expect(await verifyPassword('Old-password-1', owner.passwordHash)).toBe(false);
    for (const token of tokens) expect((await localSession(() => s).session(page(token))).userId).toBeUndefined();
    const again = await resetLocalOwnerPassword(s);
    expect(again.kind === 'reset' && again.password).not.toBe(result.password);
  });

  it('changes nothing while there is no owner, and says so', async () => {
    const s = store();
    expect(await resetLocalOwnerPassword(s)).toEqual({ kind: 'no-owner' });
    expect(await s.owner()).toBeNull();
  });
});
