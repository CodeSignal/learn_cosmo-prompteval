/**
 * Create Octavus agent sessions on a dedicated HTTP connection pool.
 *
 * Long-lived /api/trigger streams use the process-wide fetch dispatcher. When
 * that pool is saturated (or pipelined behind a streaming response), a normal
 * `octavus.agentSessions.create()` can stall until the stream ends — which
 * blocks "New chat" in the UI. Routing creates through their own Agent keeps
 * session creation independent of in-flight triggers.
 */
import { Agent, fetch as undiciFetch } from 'undici';

const createAgent = new Agent({
  connections: 8,
  pipelining: 0,
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
});

/**
 * @param {object} opts
 * @param {string} opts.baseUrl - Octavus API base URL.
 * @param {string} [opts.apiKey] - Bearer token.
 * @param {string} opts.agentId - Deployed agent id.
 * @param {Record<string, unknown>} [opts.input] - Session input interpolations.
 * @returns {Promise<string>} The new session id.
 */
export async function createAgentSession({ baseUrl, apiKey, agentId, input = {} }) {
  if (!baseUrl) throw new Error('OCTAVUS_API_URL is not configured');
  if (!agentId) throw new Error('Octavus agent id is not configured');

  const url = `${String(baseUrl).replace(/\/$/, '')}/api/agent-sessions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await undiciFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ agentId, input }),
    dispatcher: createAgent,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to create agent session (${res.status})${text ? `: ${text}` : ''}`,
    );
  }

  const data = await res.json();
  if (typeof data?.sessionId !== 'string' || !data.sessionId) {
    throw new Error('Agent session create returned no sessionId');
  }
  return data.sessionId;
}
