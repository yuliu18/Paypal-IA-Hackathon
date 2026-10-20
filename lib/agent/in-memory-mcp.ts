// Runs `work` with an MCP client connected in-process to `server`, and closes both ends afterwards
// whatever happens, so a failed request can't leave a connection open in the long-lived server.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export type McpEndpoint = { connect(transport: Transport): Promise<void>; close(): Promise<void> };

export async function withClient<T>(server: McpEndpoint, name: string, work: (client: Client) => Promise<T>): Promise<T> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  try {
    const client = new Client({ name, version: '0.1.0' });
    await client.connect(clientSide);
    try {
      return await work(client);
    } finally {
      await client.close();
    }
  } finally {
    await server.close();
  }
}
