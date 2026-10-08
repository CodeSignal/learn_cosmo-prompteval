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
  normalizeDeepSeekModelId,
  extractCompletionText,
  isUnsupportedTemperatureError,
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

describe('normalizeDeepSeekModelId', () => {
  it('preserves the supplied DeepSeek prefix', () => {
    expect(normalizeDeepSeekModelId('deepseek-v4-flash-latest'))
      .toBe('~deepseek/deepseek-v4-flash-latest');
    expect(normalizeDeepSeekModelId('deepseek/deepseek-v4-flash-latest'))
      .toBe('deepseek/deepseek-v4-flash-latest');
    expect(normalizeDeepSeekModelId('~deepseek/deepseek-v4-flash-latest'))
      .toBe('~deepseek/deepseek-v4-flash-latest');
    expect(normalizeDeepSeekModelId('deepseek-ai/deepseek-v4-flash-latest'))
      .toBe('deepseek-ai/deepseek-v4-flash-latest');
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

  it('selects openai from an openai/ model ref', () => {
    const llm = createLlmProvider({
      OPENAI_API_KEY: 'sk-test',
    }, 'openai/gpt-4o');
    expect(llm.name).toBe('openai');
    expect(llm.model).toBe(DEFAULT_OPENAI_MODEL);
  });

  it('throws when OPENAI_API_KEY is missing', () => {
    expect(() => createLlmProvider({}, 'openai/gpt-4o')).toThrow(/OPENAI_API_KEY/);
    try {
      createOpenAiProvider({});
    } catch (err) {
      expect(err.code).toBe('LLM_NOT_CONFIGURED');
    }
  });

  it('uses the model id from the session ref and strips openai/ on complete()', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createMock.mockResolvedValue({
      id: 'chatcmpl-1',
      choices: [{ message: { content: 'Paris' } }],
    });

    const llm = createLlmProvider({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://api.example.test/v1',
    }, 'openai/gpt-4o');
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
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://api.example.test/v1',
    }, 'openai/gpt-4o');
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

describe('unsupported temperature', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('retries once without temperature when the model only allows the default', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = Object.assign(
      new Error("400 Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported."),
      { status: 400 },
    );
    createMock
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ id: 'c1', choices: [{ message: { content: '0.9' } }] });
    const llm = createLlmProvider({ OPENAI_API_KEY: 'sk-test' }, 'openai/gpt-5-mini');
    const result = await llm.complete({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: 'Judge' }],
      temperature: 0,
    });
    expect(result.text).toBe('0.9');
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0][0].temperature).toBe(0);
    expect(createMock.mock.calls[1][0]).not.toHaveProperty('temperature');
    logSpy.mockRestore();
  });

  it('sends reasoning_effort only when requested', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createMock.mockResolvedValue({ id: 'c1', choices: [{ message: { content: 'ok' } }] });
    const llm = createLlmProvider({ OPENAI_API_KEY: 'sk-test' }, 'openai/gpt-5-nano');
    await llm.complete({ model: 'gpt-5-nano', messages: [{ role: 'user', content: 'Hi' }], reasoningEffort: 'minimal' });
    await llm.complete({ model: 'gpt-5-nano', messages: [{ role: 'user', content: 'Hi' }] });
    expect(createMock.mock.calls[0][0].reasoning_effort).toBe('minimal');
    expect(createMock.mock.calls[1][0]).not.toHaveProperty('reasoning_effort');
    logSpy.mockRestore();
  });

  it('lists reasoning_effort in allowed_openai_params when a LiteLLM proxy asks for it', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = Object.assign(
      new Error("400 litellm.UnsupportedParamsError: openai does not support parameters: ['reasoning_effort'], for model=gpt-6-luna. If you want to use these params dynamically send allowed_openai_params=['reasoning_effort'] in your request."),
      { status: 400 },
    );
    createMock
      .mockRejectedValueOnce(err)
      .mockResolvedValue({ id: 'c2', choices: [{ message: { content: 'ok' } }] });
    const llm = createLlmProvider({ OPENAI_API_KEY: 'sk-test' }, 'openai/gpt-6-luna');
    const req = { model: 'gpt-6-luna', messages: [{ role: 'user', content: 'Hi' }], reasoningEffort: 'low' };
    expect((await llm.complete(req)).text).toBe('ok');
    expect(createMock.mock.calls[1][0]).toMatchObject({ reasoning_effort: 'low', allowed_openai_params: ['reasoning_effort'] });
    // Remembered: the next request allows it up front, with no failed attempt.
    await llm.complete(req);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(createMock.mock.calls[2][0]).toMatchObject({ allowed_openai_params: ['reasoning_effort'] });
    logSpy.mockRestore();
  });

  it('remembers each allowed parameter and lists only those a request sends', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = Object.assign(
      new Error("400 litellm.UnsupportedParamsError: openai does not support parameters: ['temperature'], for model=gpt-6-luna. If you want to use these params dynamically send allowed_openai_params=['temperature'] in your request."),
      { status: 400 },
    );
    createMock
      .mockRejectedValueOnce(err)
      .mockResolvedValue({ id: 'c4', choices: [{ message: { content: 'ok' } }] });
    const llm = createLlmProvider({ OPENAI_API_KEY: 'sk-test' }, 'openai/gpt-6-luna');
    const base = { model: 'gpt-6-luna', messages: [{ role: 'user', content: 'Hi' }] };
    await llm.complete({ ...base, temperature: 0 });
    expect(createMock.mock.calls[1][0]).toMatchObject({ temperature: 0, allowed_openai_params: ['temperature'] });
    await llm.complete({ ...base, temperature: 0, reasoningEffort: 'low' });
    expect(createMock.mock.calls[2][0]).toMatchObject({ temperature: 0, allowed_openai_params: ['temperature'] });
    await llm.complete({ ...base, reasoningEffort: 'low' });
    expect(createMock.mock.calls[3][0]).not.toHaveProperty('allowed_openai_params');
    expect(createMock).toHaveBeenCalledTimes(4);
    logSpy.mockRestore();
  });

  it('adds a second rejected parameter to the allow list instead of dropping it', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hint = (param) => Object.assign(
      new Error(`400 litellm.UnsupportedParamsError: openai does not support parameters: ['${param}'], for model=gpt-6-luna. If you want to use these params dynamically send allowed_openai_params=['${param}'] in your request.`),
      { status: 400 },
    );
    createMock
      .mockRejectedValueOnce(hint('reasoning_effort'))
      .mockRejectedValueOnce(hint('temperature'))
      .mockResolvedValueOnce({ id: 'c5', choices: [{ message: { content: 'ok' } }] });
    const llm = createLlmProvider({ OPENAI_API_KEY: 'sk-test' }, 'openai/gpt-6-luna');
    await llm.complete({ model: 'gpt-6-luna', messages: [{ role: 'user', content: 'Hi' }], temperature: 0, reasoningEffort: 'low' });
    expect(createMock.mock.calls[2][0]).toMatchObject({
      temperature: 0,
      reasoning_effort: 'low',
      allowed_openai_params: ['reasoning_effort', 'temperature'],
    });
    logSpy.mockRestore();
  });

  it('keeps the rest of the allow list when it drops a parameter', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hint = Object.assign(
      new Error("400 litellm.UnsupportedParamsError: openai does not support parameters: ['reasoning_effort'], for model=gpt-6-luna. If you want to use these params dynamically send allowed_openai_params=['reasoning_effort'] in your request."),
      { status: 400 },
    );
    const noTemperature = Object.assign(
      new Error("400 Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported."),
      { status: 400 },
    );
    createMock
      .mockRejectedValueOnce(hint)
      .mockRejectedValueOnce(noTemperature)
      .mockResolvedValueOnce({ id: 'c6', choices: [{ message: { content: 'ok' } }] });
    const llm = createLlmProvider({ OPENAI_API_KEY: 'sk-test' }, 'openai/gpt-6-luna');
    await llm.complete({ model: 'gpt-6-luna', messages: [{ role: 'user', content: 'Hi' }], temperature: 0, reasoningEffort: 'low' });
    expect(createMock.mock.calls[2][0]).not.toHaveProperty('temperature');
    expect(createMock.mock.calls[2][0]).toMatchObject({ reasoning_effort: 'low', allowed_openai_params: ['reasoning_effort'] });
    logSpy.mockRestore();
  });

  it('drops a rejected optional parameter when the proxy gives no allow hint', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = Object.assign(new Error('400 Unrecognized request argument supplied: reasoning_effort'), { status: 400 });
    createMock
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ id: 'c3', choices: [{ message: { content: 'ok' } }] });
    const llm = createLlmProvider({ OPENAI_API_KEY: 'sk-test' }, 'openai/gpt-6-luna');
    await llm.complete({ model: 'gpt-6-luna', messages: [{ role: 'user', content: 'Hi' }], reasoningEffort: 'low' });
    expect(createMock.mock.calls[1][0]).not.toHaveProperty('reasoning_effort');
    logSpy.mockRestore();
  });

  it('only matches 400 errors about temperature support', () => {
    expect(isUnsupportedTemperatureError(Object.assign(new Error('temperature not supported'), { status: 400 }))).toBe(true);
    expect(isUnsupportedTemperatureError(Object.assign(new Error('temperature not supported'), { status: 429 }))).toBe(false);
    expect(isUnsupportedTemperatureError(Object.assign(new Error('Unsupported value: top_p'), { status: 400 }))).toBe(false);
  });
});

describe('createLlmProvider deepseek', () => {
  beforeEach(() => {
    createMock.mockReset();
    constructorOpts.mockReset();
  });

  it('uses the OpenAI SDK with DeepSeek env vars', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createMock.mockResolvedValue({
      id: 'chatcmpl-ds',
      choices: [{ message: { content: 'Paris' } }],
    });

    const llm = createLlmProvider({
      DEEPSEEK_API_KEY: 'sk-deepseek',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.test/v1',
      OPENAI_API_KEY: 'sk-openai',
      OPENAI_BASE_URL: 'https://api.openai.test/v1',
    }, '~deepseek/deepseek-v4-flash-latest');
    expect(llm.name).toBe('deepseek');
    expect(llm.model).toBe('~deepseek/deepseek-v4-flash-latest');
    expect(constructorOpts).toHaveBeenCalledWith({
      apiKey: 'sk-deepseek',
      baseURL: 'https://api.deepseek.test/v1',
    });

    const result = await llm.complete({
      model: 'deepseek/deepseek-v4-flash-latest',
      messages: [{ role: 'user', content: 'Capital of France?' }],
    });

    expect(result).toEqual({ text: 'Paris', requestId: 'chatcmpl-ds' });
    expect(logSpy).toHaveBeenCalledWith(
      '[llm] request {"provider":"deepseek","model":"deepseek/deepseek-v4-flash-latest","baseURL":"https://api.deepseek.test/v1","messageCount":1}',
    );
    expect(createMock).toHaveBeenCalledWith({
      model: 'deepseek/deepseek-v4-flash-latest',
      messages: [{ role: 'user', content: 'Capital of France?' }],
    });
    logSpy.mockRestore();
  });

  it('accepts a base URL that already ends in /chat/completions', () => {
    createLlmProvider({
      DEEPSEEK_API_KEY: 'sk-deepseek',
      DEEPSEEK_BASE_URL: 'https://openrouter.ai/api/v1/chat/completions',
    }, '~deepseek/deepseek-v4-flash-latest');
    expect(constructorOpts).toHaveBeenCalledWith({
      apiKey: 'sk-deepseek',
      baseURL: 'https://openrouter.ai/api/v1',
    });
  });

  it('sends a deepseek/ model ref with its original prefix', async () => {
    createMock.mockResolvedValue({
      id: 'chatcmpl-ds-alias',
      choices: [{ message: { content: 'Paris' } }],
    });
    const llm = createLlmProvider({
      DEEPSEEK_API_KEY: 'sk-deepseek',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.test/v1',
    }, 'deepseek/deepseek-v4-flash-latest');

    await llm.complete({ model: llm.model, messages: [{ role: 'user', content: 'Hi' }] });

    expect(llm.model).toBe('deepseek/deepseek-v4-flash-latest');
    expect(createMock).toHaveBeenCalledWith({
      model: 'deepseek/deepseek-v4-flash-latest',
      messages: [{ role: 'user', content: 'Hi' }],
    });
  });

  it('sends a deepseek-ai/ model ref with its original prefix', async () => {
    createMock.mockResolvedValue({
      id: 'chatcmpl-ds-ai',
      choices: [{ message: { content: 'Paris' } }],
    });
    const llm = createLlmProvider({
      DEEPSEEK_API_KEY: 'sk-deepseek',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.test/v1',
    }, 'deepseek-ai/deepseek-v4-flash-latest');

    await llm.complete({ model: llm.model, messages: [{ role: 'user', content: 'Hi' }] });

    expect(llm.model).toBe('deepseek-ai/deepseek-v4-flash-latest');
    expect(createMock).toHaveBeenCalledWith({
      model: 'deepseek-ai/deepseek-v4-flash-latest',
      messages: [{ role: 'user', content: 'Hi' }],
    });
  });

  it('falls back to OPENAI_* when both DeepSeek env vars are unset (prod proxy hack)', () => {
    createLlmProvider({
      OPENAI_API_KEY: 'sk-openai',
      OPENAI_BASE_URL: 'https://api.openai.test/v1',
    }, '~deepseek/deepseek-v4-flash-latest');
    expect(constructorOpts).toHaveBeenCalledWith({
      apiKey: 'sk-openai',
      baseURL: 'https://api.openai.test/v1',
    });
  });

  it('falls back to OPENAI_* when both DeepSeek env vars are blank', () => {
    createLlmProvider({
      DEEPSEEK_API_KEY: '  ',
      DEEPSEEK_BASE_URL: '',
      OPENAI_API_KEY: 'sk-openai',
      OPENAI_BASE_URL: 'https://api.openai.test/v1',
    }, 'deepseek/deepseek-v4-flash-latest');
    expect(constructorOpts).toHaveBeenCalledWith({
      apiKey: 'sk-openai',
      baseURL: 'https://api.openai.test/v1',
    });
  });

  it('requires DEEPSEEK_BASE_URL when DEEPSEEK_API_KEY is set', () => {
    expect(() => createLlmProvider({
      DEEPSEEK_API_KEY: 'sk-deepseek',
      OPENAI_API_KEY: 'sk-openai',
      OPENAI_BASE_URL: 'https://api.openai.test/v1',
    }, '~deepseek/deepseek-v4-flash-latest')).toThrow(/DEEPSEEK_BASE_URL/);
    try {
      createLlmProvider({
        DEEPSEEK_API_KEY: 'sk-deepseek',
      }, '~deepseek/deepseek-v4-flash-latest');
    } catch (err) {
      expect(err.code).toBe('LLM_NOT_CONFIGURED');
    }
  });

  it('does not fall back when only DEEPSEEK_BASE_URL is set', () => {
    expect(() => createLlmProvider({
      DEEPSEEK_BASE_URL: 'https://api.deepseek.test/v1',
      OPENAI_API_KEY: 'sk-openai',
    }, 'deepseek/deepseek-v4-flash-latest')).toThrow(/DEEPSEEK_API_KEY/);
  });

  it('throws when DeepSeek env is unset and OPENAI_API_KEY is also missing', () => {
    expect(() => createLlmProvider({}, 'deepseek/deepseek-v4-flash-latest'))
      .toThrow(/OPENAI_API_KEY/);
  });
});
