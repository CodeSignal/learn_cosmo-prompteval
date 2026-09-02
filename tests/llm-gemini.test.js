import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateContent = vi.fn();
const constructorOpts = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class GoogleGenAI {
      constructor(opts) {
        constructorOpts(opts);
        this.models = { generateContent };
      }
    },
  };
});

const {
  createGeminiProvider,
  normalizeGeminiModelId,
  extractGenerateText,
  toGeminiContents,
  DEFAULT_GEMINI_MODEL,
} = await import('../lib/llm/gemini.js');
const { createLlmProvider } = await import('../lib/llm/provider.js');

describe('normalizeGeminiModelId', () => {
  it('strips a google/ prefix', () => {
    expect(normalizeGeminiModelId('google/gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });

  it('strips a gemini/ prefix', () => {
    expect(normalizeGeminiModelId('gemini/gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });

  it('leaves a bare model id unchanged', () => {
    expect(normalizeGeminiModelId('gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });
});

describe('extractGenerateText', () => {
  it('prefers the text helper', () => {
    expect(extractGenerateText({ text: 'Hello world' })).toBe('Hello world');
  });

  it('joins candidate parts', () => {
    expect(extractGenerateText({
      candidates: [{ content: { parts: [{ text: 'Hello' }, { text: ' world' }] } }],
    })).toBe('Hello world');
  });
});

describe('toGeminiContents', () => {
  it('maps assistant turns to model', () => {
    expect(toGeminiContents([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ])).toEqual([
      { role: 'user', parts: [{ text: 'Hi' }] },
      { role: 'model', parts: [{ text: 'Hello' }] },
    ]);
  });
});

describe('createLlmProvider gemini', () => {
  beforeEach(() => {
    generateContent.mockReset();
    constructorOpts.mockReset();
  });

  it('selects gemini when LLM_PROVIDER=gemini', () => {
    const llm = createLlmProvider({
      LLM_PROVIDER: 'gemini',
      GOOGLE_API_KEY: 'sk-test',
    });
    expect(llm.name).toBe('gemini');
    expect(llm.model).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('throws when GOOGLE_API_KEY is missing', () => {
    expect(() => createLlmProvider({ LLM_PROVIDER: 'gemini' })).toThrow(/GOOGLE_API_KEY/);
    try {
      createGeminiProvider({});
    } catch (err) {
      expect(err.code).toBe('LLM_NOT_CONFIGURED');
    }
  });

  it('strips google/ from GOOGLE_MODEL and from complete() requests', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    generateContent.mockResolvedValue({
      text: 'Paris',
      responseId: 'resp-1',
    });

    const llm = createLlmProvider({
      LLM_PROVIDER: 'gemini',
      GOOGLE_API_KEY: 'sk-test',
      GOOGLE_BASE_URL: 'https://generativelanguage.example.test',
      GOOGLE_MODEL: 'google/gemini-2.5-flash',
    });
    expect(llm.model).toBe('gemini-2.5-flash');
    expect(constructorOpts).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      httpOptions: { baseUrl: 'https://generativelanguage.example.test' },
    });

    const result = await llm.complete({
      model: 'google/gemini-2.5-pro',
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'Capital of France?' }],
      temperature: 0.2,
    });

    expect(result).toEqual({ text: 'Paris', requestId: 'resp-1' });
    expect(logSpy).toHaveBeenCalledWith(
      '[llm] request {"provider":"gemini","model":"gemini-2.5-pro","baseURL":"https://generativelanguage.example.test","temperature":0.2,"messageCount":1}',
    );
    expect(generateContent).toHaveBeenCalledWith({
      model: 'gemini-2.5-pro',
      contents: [{ role: 'user', parts: [{ text: 'Capital of France?' }] }],
      config: {
        systemInstruction: 'Be brief.',
        temperature: 0.2,
      },
    });
    logSpy.mockRestore();
  });

  it('logs and rethrows when the Gemini API fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429, code: 429 });
    generateContent.mockRejectedValueOnce(err);

    const llm = createLlmProvider({
      LLM_PROVIDER: 'gemini',
      GOOGLE_API_KEY: 'sk-test',
      GOOGLE_BASE_URL: 'https://generativelanguage.example.test',
    });
    await expect(llm.complete({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'Hi' }],
    })).rejects.toBe(err);
    expect(errorSpy).toHaveBeenCalledWith(
      '[llm] error {"provider":"gemini","model":"gemini-2.5-flash","message":"RESOURCE_EXHAUSTED","status":429,"code":429,"baseURL":"https://generativelanguage.example.test"}',
    );
    errorSpy.mockRestore();
  });
});
