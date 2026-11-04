// How long the app waits for the shop's model. A model on the owner's machine or network (Ollama,
// LM Studio, a llama.cpp or vLLM server) runs on their own hardware and is often several times
// slower than a hosted one, so it gets longer waits; a hosted provider keeps the shorter ones, which
// also keep a hung provider from holding the guard's write queue.

export type LlmTimeouts = {
  // One answer of the support, billing or sales agent.
  agentStepMs: number;
  // A whole ticket, every agent step included.
  agentTicketMs: number;
  // One verdict of the guard's judge (asked once more after a timeout).
  judgeMs: number;
  // One answer of the guard assistant on /guard.
  assistantMs: number;
  // Reading a document in Settings › From your documents.
  documentsMs: number;
};

export const CLOUD_TIMEOUTS: LlmTimeouts = { agentStepMs: 60_000, agentTicketMs: 90_000, judgeMs: 15_000, assistantMs: 30_000, documentsMs: 150_000 };
export const LOCAL_TIMEOUTS: LlmTimeouts = { agentStepMs: 180_000, agentTicketMs: 300_000, judgeMs: 60_000, assistantMs: 120_000, documentsMs: 300_000 };

function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (['localhost', '0.0.0.0', '::1', 'host.docker.internal'].includes(host) || host.endsWith('.local')) return true;
  const ip = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function llmTimeouts(baseUrl: string): LlmTimeouts {
  try {
    return isLocalHost(new URL(baseUrl).hostname) ? LOCAL_TIMEOUTS : CLOUD_TIMEOUTS;
  } catch {
    return CLOUD_TIMEOUTS;
  }
}
