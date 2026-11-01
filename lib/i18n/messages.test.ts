import { describe, expect, it } from 'vitest';
import { withFallback } from './messages';

describe('withFallback', () => {
  it('keeps every translated message and fills the missing ones from English', () => {
    const english = { nav: { overview: 'Overview', settings: 'Settings' }, common: { on: 'On' } };
    const spanish = { nav: { overview: 'Resumen' } };
    expect(withFallback(spanish, english)).toEqual({ nav: { overview: 'Resumen', settings: 'Settings' }, common: { on: 'On' } });
  });

  it('never lets an empty translation hide the English text', () => {
    expect(withFallback({ nav: { overview: '' } }, { nav: { overview: 'Overview' } })).toEqual({ nav: { overview: 'Overview' } });
  });
});
