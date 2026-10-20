import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { withClient } from './in-memory-mcp';

function server() {
  const s = new McpServer({ name: 'test-server', version: '0.0.0' });
  s.registerTool('ping', { description: 'ping' }, async () => ({ content: [{ type: 'text' as const, text: 'pong' }] }));
  return s;
}

describe('withClient', () => {
  it('connects a client to the server, returns what the callback returns and disconnects both', async () => {
    const s = server();
    const result = await withClient(s, 'test-client', async (client) => {
      expect(s.isConnected()).toBe(true);
      return (await client.callTool({ name: 'ping' })).content;
    });
    expect(result).toEqual([{ type: 'text', text: 'pong' }]);
    expect(s.isConnected()).toBe(false);
  });

  it('disconnects the server when the callback throws', async () => {
    const s = server();
    await expect(withClient(s, 'test-client', async () => Promise.reject(new Error('agent failed')))).rejects.toThrow('agent failed');
    expect(s.isConnected()).toBe(false);
  });

  it('disconnects the outer server when an inner connection fails', async () => {
    const outer = server();
    const broken = { connect: async () => Promise.reject(new Error('connect failed')), close: async () => undefined };
    await expect(withClient(outer, 'outer', () => withClient(broken, 'inner', async () => 'never'))).rejects.toThrow('connect failed');
    expect(outer.isConnected()).toBe(false);
  });
});
