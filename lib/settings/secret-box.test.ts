import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret } from './secret-box';

const SECRET = 'a-long-settings-secret-for-tests';

describe('secret box', () => {
  it('opens what it sealed, and the sealed text never contains the plain key', () => {
    const sealed = sealSecret('sk-live-1234567890', SECRET);
    expect(sealed).not.toContain('sk-live');
    expect(openSecret(sealed, SECRET)).toBe('sk-live-1234567890');
  });

  it('seals the same key differently each time', () => {
    expect(sealSecret('same', SECRET)).not.toBe(sealSecret('same', SECRET));
  });

  it('cannot open with another settings secret or after tampering', () => {
    const sealed = sealSecret('sk-live-1234567890', SECRET);
    expect(openSecret(sealed, 'another-long-settings-secret')).toBeUndefined();
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('AA') ? 'BB' : 'AA');
    expect(openSecret(tampered, SECRET)).toBeUndefined();
    expect(openSecret('not sealed', SECRET)).toBeUndefined();
  });
});
