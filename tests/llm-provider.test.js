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
const { createLlmProvider } = await import('../lib/llm/provider.js');

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
      LLM_PROVIDER: 'openai',
      ANTHROPIC_API_KEY: 'sk-test',
    })).toThrow(/Unsupported LLM_PROVIDER "openai"/);
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
    expect(createMock).toHaveBeenCalledWith({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'Capital of France?' }],
      temperature: 0.2,
    });
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
