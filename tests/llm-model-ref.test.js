import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODEL_REF,
  parseModelRef,
  requiredApiKeyName,
} from '../lib/llm/model-ref.js';

describe('parseModelRef', () => {
  it('defaults to anthropic when the ref is missing', () => {
    expect(parseModelRef()).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      prefix: 'anthropic',
      raw: DEFAULT_MODEL_REF,
      apiKeyName: 'ANTHROPIC_API_KEY',
    });
    expect(parseModelRef('')).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    });
  });

  it('routes openai and google prefixes', () => {
    expect(parseModelRef('openai/gpt-5.6-luna')).toMatchObject({
      provider: 'openai',
      modelId: 'gpt-5.6-luna',
      prefix: 'openai',
      apiKeyName: 'OPENAI_API_KEY',
    });
    expect(parseModelRef('google/gemini-3.6-flash')).toMatchObject({
      provider: 'gemini',
      modelId: 'gemini-3.6-flash',
      prefix: 'google',
      apiKeyName: 'GOOGLE_API_KEY',
    });
    expect(parseModelRef('gemini/gemini-2.5-flash')).toMatchObject({
      provider: 'gemini',
      modelId: 'gemini-2.5-flash',
      prefix: 'gemini',
    });
  });

  it('routes DeepSeek prefixes to the same OpenAI-compatible provider', () => {
    expect(parseModelRef('deepseek/deepseek-v4-flash-latest')).toMatchObject({
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash-latest',
      prefix: 'deepseek',
      apiKeyName: 'DEEPSEEK_API_KEY',
    });
    expect(parseModelRef('~deepseek/deepseek-v4-flash-latest')).toMatchObject({
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash-latest',
      prefix: 'deepseek',
      apiKeyName: 'DEEPSEEK_API_KEY',
    });
    expect(parseModelRef('deepseek-ai/deepseek-v4-flash-latest')).toMatchObject({
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash-latest',
      prefix: 'deepseek-ai',
      apiKeyName: 'DEEPSEEK_API_KEY',
    });
  });

  it('trims whitespace and lowercases the prefix', () => {
    expect(parseModelRef('  OpenAI/gpt-5.6-luna  ')).toMatchObject({
      provider: 'openai',
      modelId: 'gpt-5.6-luna',
      prefix: 'openai',
    });
  });

  it('keeps extra slashes in the model id', () => {
    expect(parseModelRef('openai/ft:gpt-4o/custom')).toMatchObject({
      provider: 'openai',
      modelId: 'ft:gpt-4o/custom',
    });
  });

  it('rejects a missing slash or empty model id', () => {
    expect(() => parseModelRef('gpt-5.6-luna')).toThrow(/provider\/model-id/);
    expect(() => parseModelRef('openai/')).toThrow(/provider\/model-id/);
    try {
      parseModelRef('bare-model');
    } catch (err) {
      expect(err.code).toBe('LLM_INVALID_MODEL');
    }
  });

  it('rejects an unknown provider prefix', () => {
    expect(() => parseModelRef('mistral/large')).toThrow(/Unsupported model provider "mistral"/);
    try {
      parseModelRef('mistral/large');
    } catch (err) {
      expect(err.code).toBe('LLM_UNSUPPORTED_PROVIDER');
    }
  });
});

describe('requiredApiKeyName', () => {
  it('maps a model ref to the provider API key env var', () => {
    expect(requiredApiKeyName()).toBe('ANTHROPIC_API_KEY');
    expect(requiredApiKeyName(DEFAULT_MODEL_REF)).toBe('ANTHROPIC_API_KEY');
    expect(requiredApiKeyName('openai/gpt-5.6-luna')).toBe('OPENAI_API_KEY');
    expect(requiredApiKeyName('google/gemini-3.6-flash')).toBe('GOOGLE_API_KEY');
    expect(requiredApiKeyName('deepseek/deepseek-v4-flash-latest')).toBe('DEEPSEEK_API_KEY');
    expect(requiredApiKeyName('~deepseek/deepseek-v4-flash-latest')).toBe('DEEPSEEK_API_KEY');
  });
});
