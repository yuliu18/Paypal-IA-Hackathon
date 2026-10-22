import { describe, expect, it } from 'vitest';
import { latestOnly, matchOptions } from './picker-logic';

const OPTIONS = [
  { value: 'deepseek', label: 'DeepSeek', group: 'China' },
  { value: 'openai', label: 'OpenAI', group: 'Global' },
  { value: 'opencode-go', label: 'OpenCode Go', group: 'Gateway' },
];

describe('matchOptions', () => {
  it('finds options by every typed word, in label, value or group', () => {
    expect(matchOptions(OPTIONS, 'open go', false).map((o) => o.value)).toEqual(['opencode-go']);
    expect(matchOptions(OPTIONS, 'china', false).map((o) => o.value)).toEqual(['deepseek']);
    expect(matchOptions(OPTIONS, '', false)).toEqual(OPTIONS);
  });

  it('offers what was typed as a value only when custom values are allowed and it is not already an option', () => {
    expect(matchOptions(OPTIONS, 'my-model', true).map((o) => [o.value, o.label])).toEqual([['my-model', 'Use “my-model”']]);
    expect(matchOptions(OPTIONS, 'my-model', false)).toEqual([]);
    expect(matchOptions(OPTIONS, 'openai', true).map((o) => o.value)).toEqual(['openai']);
  });
});

describe('latestOnly', () => {
  it('lets only the last started request apply its answer', async () => {
    const applied: string[] = [];
    const run = latestOnly<string>();
    let finishFirst: (value: string) => void = () => {};
    const first = run(() => new Promise<string>((resolve) => (finishFirst = resolve)), (v: string) => applied.push(v));
    const second = run(async () => 'deepseek models', (v: string) => applied.push(v));
    await second;
    finishFirst('openrouter models');
    await first;
    expect(applied).toEqual(['deepseek models']);
  });

  it('turns a failed request into the fallback answer', async () => {
    const applied: string[][] = [];
    await latestOnly<string[]>()(async () => {
      throw new Error('offline');
    }, (v: string[]) => applied.push(v), []);
    expect(applied).toEqual([[]]);
  });
});
