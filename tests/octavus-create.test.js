import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from 'undici';

const fetchMock = vi.fn();

vi.mock('undici', async () => {
  const actual = await vi.importActual('undici');
  return {
    ...actual,
    fetch: (...args) => fetchMock(...args),
  };
});

const { createAgentSession } = await import('../lib/octavus-create.js');

describe('createAgentSession', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it('POSTs to /api/agent-sessions on a dedicated dispatcher', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: 'sess-123' }),
    });

    const id = await createAgentSession({
      baseUrl: 'https://octavus.example/',
      apiKey: 'secret',
      agentId: 'agent-1',
      input: { MODEL: 'x' },
    });

    expect(id).toBe('sess-123');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://octavus.example/api/agent-sessions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body)).toEqual({ agentId: 'agent-1', input: { MODEL: 'x' } });
    expect(init.dispatcher).toBeInstanceOf(Agent);
  });

  it('throws when the API returns a non-OK status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'busy',
    });

    await expect(
      createAgentSession({
        baseUrl: 'https://octavus.example',
        apiKey: 'secret',
        agentId: 'agent-1',
      }),
    ).rejects.toThrow(/503/);
  });

  it('throws when baseUrl is missing', async () => {
    await expect(
      createAgentSession({ agentId: 'agent-1' }),
    ).rejects.toThrow(/OCTAVUS_API_URL/);
  });

  it('throws when a 200 response has no string sessionId', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: null }),
    });

    await expect(
      createAgentSession({
        baseUrl: 'https://octavus.example',
        apiKey: 'secret',
        agentId: 'agent-1',
      }),
    ).rejects.toThrow(/no sessionId/);
  });
});
