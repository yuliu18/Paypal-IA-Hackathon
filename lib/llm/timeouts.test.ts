import { describe, expect, it } from 'vitest';
import { CLOUD_TIMEOUTS, LOCAL_TIMEOUTS, llmTimeouts } from './timeouts';

describe('llmTimeouts', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://127.0.0.1:1234/v1',
    'http://[::1]:8000/v1',
    'http://0.0.0.0:8080/v1',
    'http://host.docker.internal:11434/v1',
    'http://192.168.1.20:11434/v1',
    'http://10.0.0.5:8000/v1',
    'http://172.20.0.2:8000/v1',
    'http://gpu-box.local:11434/v1',
  ])('gives a model on this machine or network the longer waits: %s', (baseUrl) => {
    expect(llmTimeouts(baseUrl)).toBe(LOCAL_TIMEOUTS);
  });

  it.each(['https://api.openai.com/v1', 'https://opencode.ai/zen/go/v1', 'https://172.32.0.1/v1', 'not a url', ''])(
    'keeps the cloud waits for anything else: %s',
    (baseUrl) => {
      expect(llmTimeouts(baseUrl)).toBe(CLOUD_TIMEOUTS);
    },
  );

  it('waits longer for a local model at every step', () => {
    for (const key of Object.keys(CLOUD_TIMEOUTS) as (keyof typeof CLOUD_TIMEOUTS)[]) {
      expect(LOCAL_TIMEOUTS[key]).toBeGreaterThan(CLOUD_TIMEOUTS[key]);
    }
  });

  it('keeps the cloud waits the app already used', () => {
    expect(CLOUD_TIMEOUTS).toEqual({ agentStepMs: 60_000, agentTicketMs: 90_000, judgeMs: 15_000, assistantMs: 30_000, documentsMs: 150_000 });
  });
});
