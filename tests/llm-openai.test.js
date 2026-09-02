import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
const constructorOpts = vi.fn();

vi.mock('openai', () => {
  return {
    default: class OpenAI {
      constructor(opts) {
        constructorOpts(opts);
        this.chat = { completions: { create: createMock } };
      }
    },
  };
});

const {
  createOpenAiProvider,
  normalizeOpenAiModelId,
  extractCompletionText,
  DEFAULT_OPENAI_MODEL,
} = await import('../lib/llm/openai.js');
const { createLlmProvider } = await import('../lib/llm/provider.js');

describe('normalizeOpenAiModelId', () => {
  it('strips an openai/ prefix', () => {
    expect(normalizeOpenAiModelId('openai/gpt-4o')).toBe('gpt-4o');
  });

  it('leaves a bare model id unchanged', () => {
    expect(normalizeOpenAiModelId('gpt-4o')).toBe('gpt-4o');
  });
});

describe('extractCompletionText', () => {
  it('reads string content', () => {
    expect(extractCompletionText({
      choices: [{ message: { content: 'Hello world' } }],
    })).toBe('Hello world');
  });

  it('joins text parts', () => {
    expect(extractCompletionText({
      choices: [{
        message: {
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: ' world' },
          ],
        },
      }],
    })).toBe('Hello world');
  });
});

describe('createLlmProvider openai', () => {
  beforeEach(() => {
    createMock.mockReset();
    constructorOpts.mockReset();
  });

  it('selects openai when LLM_PROVIDER=openai', () => {
    const llm = createLlmProvider({
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(llm.name).toBe('openai');
    expect(llm.model).toBe(DEFAULT_OPENAI_MODEL);
  });

  it('throws when OPENAI_API_KEY is missing', () => {
    expect(() => createLlmProvider({ LLM_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
    try {
      createOpenAiProvider({});
    } catch (err) {
      expect(err.code).toBe('LLM_NOT_CONFIGURED');
    }
  });

  it('strips openai/ from OPENAI_MODEL and from complete() requests', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createMock.mockResolvedValue({
      id: 'chatcmpl-1',
      choices: [{ message: { content: 'Paris' } }],
    });

    const llm = createLlmProvider({
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://api.example.test/v1',
      OPENAI_MODEL: 'openai/gpt-4o',
    });
    expect(llm.model).toBe('gpt-4o');
    expect(constructorOpts).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://api.example.test/v1',
    });

    const result = await llm.complete({
      model: 'openai/gpt-4.1',
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'Capital of France?' }],
      temperature: 0.2,
    });

    expect(result).toEqual({ text: 'Paris', requestId: 'chatcmpl-1' });
    expect(logSpy).toHaveBeenCalledWith(
      '[llm] request {"provider":"openai","model":"gpt-4.1","baseURL":"https://api.example.test/v1","temperature":0.2,"messageCount":2}',
    );
    expect(createMock).toHaveBeenCalledWith({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Capital of France?' },
      ],
      temperature: 0.2,
    });
    logSpy.mockRestore();
  });

  it('logs and rethrows when the OpenAI API fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('insufficient_quota'), { status: 429, code: 'insufficient_quota' });
    createMock.mockRejectedValueOnce(err);

    const llm = createLlmProvider({
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://api.example.test/v1',
    });
    await expect(llm.complete({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
    })).rejects.toBe(err);
    expect(errorSpy).toHaveBeenCalledWith(
      '[llm] error {"provider":"openai","model":"gpt-4o","message":"insufficient_quota","status":429,"code":"insufficient_quota","baseURL":"https://api.example.test/v1"}',
    );
    errorSpy.mockRestore();
  });
});
