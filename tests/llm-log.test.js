import { describe, it, expect, vi, afterEach } from 'vitest';
import { logLlmFailure, logLlmRequest, summarizeLlmError } from '../lib/llm/log.js';

describe('logLlmRequest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs provider and settings without undefined fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logLlmRequest({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      baseURL: 'https://api.example.test',
      temperature: 0.2,
      max_tokens: 4096,
      messageCount: 1,
    });
    expect(spy).toHaveBeenCalledWith(
      '[llm] request {"provider":"anthropic","model":"claude-sonnet-4-6","baseURL":"https://api.example.test","temperature":0.2,"max_tokens":4096,"messageCount":1}',
    );
  });

  it('omits optional settings that were not set', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logLlmRequest({ provider: 'openai', model: 'gpt-4o' });
    expect(spy).toHaveBeenCalledWith('[llm] request {"provider":"openai","model":"gpt-4o"}');
  });
});

describe('summarizeLlmError', () => {
  it('keeps message, status, code, type, and request id', () => {
    const err = Object.assign(new Error('429 rate limited'), {
      status: 429,
      code: 'rate_limit_error',
      type: 'rate_limit_error',
      requestID: 'req_123',
    });
    expect(summarizeLlmError(err)).toEqual({
      message: '429 rate limited',
      status: 429,
      code: 'rate_limit_error',
      type: 'rate_limit_error',
      requestId: 'req_123',
    });
  });

  it('falls back for a non-Error value', () => {
    expect(summarizeLlmError('boom')).toEqual({ message: 'LLM request failed' });
  });
});

describe('logLlmFailure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a one-line error with provider and safe error fields', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('model not found'), {
      status: 404,
      code: 'model_not_found',
    });
    logLlmFailure({
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.example.test/v1',
    }, err);
    expect(spy).toHaveBeenCalledWith(
      '[llm] error {"provider":"openai","model":"gpt-4o","message":"model not found","status":404,"code":"model_not_found","baseURL":"https://api.example.test/v1"}',
    );
  });
});
