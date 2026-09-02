import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      constructor(opts) {
        this.opts = opts;
        this.messages = { create: createMock };
      }
    },
  };
});

const {
  createAnthropicProvider,
  normalizeAnthropicModelId,
  extractMessageText,
  DEFAULT_ANTHROPIC_MODEL,
} = await import('../lib/llm/anthropic.js');
const { createLlmProvider, requiredApiKeyName } = await import('../lib/llm/provider.js');

describe('normalizeAnthropicModelId', () => {
  it('strips an anthropic/ prefix', () => {
    expect(normalizeAnthropicModelId('anthropic/claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('leaves a bare model id unchanged', () => {
    expect(normalizeAnthropicModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });
});

describe('extractMessageText', () => {
  it('joins text blocks', () => {
    expect(extractMessageText({
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: ' world' },
      ],
    })).toBe('Hello world');
  });
});

describe('createLlmProvider', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('defaults to anthropic', () => {
    const llm = createLlmProvider({ ANTHROPIC_API_KEY: 'sk-test' });
    expect(llm.name).toBe('anthropic');
    expect(llm.model).toBe(DEFAULT_ANTHROPIC_MODEL);
  });

  it('throws on an unknown provider', () => {
    expect(() => createLlmProvider({
      LLM_PROVIDER: 'mistral',
      ANTHROPIC_API_KEY: 'sk-test',
    })).toThrow(/Unsupported LLM_PROVIDER "mistral"/);
  });

  it('reports the API key env var for the selected provider', () => {
    expect(requiredApiKeyName({})).toBe('ANTHROPIC_API_KEY');
    expect(requiredApiKeyName({ LLM_PROVIDER: 'openai' })).toBe('OPENAI_API_KEY');
    expect(requiredApiKeyName({ LLM_PROVIDER: 'gemini' })).toBe('GOOGLE_API_KEY');
  });

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    expect(() => createLlmProvider({ LLM_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
    try {
      createAnthropicProvider({});
    } catch (err) {
      expect(err.code).toBe('LLM_NOT_CONFIGURED');
    }
  });

  it('strips anthropic/ from ANTHROPIC_MODEL and from complete() requests', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createMock.mockResolvedValue({
      id: 'msg-1',
      _request_id: 'req_abc',
      content: [{ type: 'text', text: 'Paris' }],
    });

    const llm = createLlmProvider({
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_BASE_URL: 'https://api.example.test',
      ANTHROPIC_MODEL: 'anthropic/claude-sonnet-4-6',
    });
    expect(llm.model).toBe('claude-sonnet-4-6');

    const result = await llm.complete({
      model: 'anthropic/claude-opus-4-6',
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'Capital of France?' }],
      temperature: 0.2,
    });

    expect(result).toEqual({ text: 'Paris', requestId: 'req_abc' });
    expect(logSpy).toHaveBeenCalledWith(
      '[llm] request {"provider":"anthropic","model":"claude-opus-4-6","baseURL":"https://api.example.test","temperature":0.2,"max_tokens":4096,"messageCount":1}',
    );
    expect(createMock).toHaveBeenCalledWith({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'Capital of France?' }],
      temperature: 0.2,
    });
    logSpy.mockRestore();
  });

  it('logs and rethrows when the Anthropic API fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('overloaded'), { status: 529 });
    createMock.mockRejectedValueOnce(err);

    const llm = createLlmProvider({
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_BASE_URL: 'https://api.example.test',
    });
    await expect(llm.complete({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hi' }],
    })).rejects.toBe(err);
    expect(errorSpy).toHaveBeenCalledWith(
      '[llm] error {"provider":"anthropic","model":"claude-sonnet-4-6","message":"overloaded","status":529,"baseURL":"https://api.example.test"}',
    );
    errorSpy.mockRestore();
  });

  it('omits requestId when _request_id is not a string', async () => {
    createMock.mockResolvedValue({
      id: 'msg-1',
      content: [{ type: 'text', text: 'Paris' }],
    });

    const llm = createAnthropicProvider({ ANTHROPIC_API_KEY: 'sk-test' });
    const result = await llm.complete({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.text).toBe('Paris');
    expect(result.requestId).toBeUndefined();
  });
});
