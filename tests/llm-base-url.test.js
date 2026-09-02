import { describe, it, expect } from 'vitest';
import { optionalBaseUrl } from '../lib/llm/base-url.js';
import { createOpenAiProvider } from '../lib/llm/openai.js';
import { createAnthropicProvider } from '../lib/llm/anthropic.js';
import { createGeminiProvider } from '../lib/llm/gemini.js';

describe('optionalBaseUrl', () => {
  it('returns undefined for absent or blank values', () => {
    expect(optionalBaseUrl(undefined, 'OPENAI_BASE_URL')).toBeUndefined();
    expect(optionalBaseUrl('', 'OPENAI_BASE_URL')).toBeUndefined();
    expect(optionalBaseUrl('   ', 'OPENAI_BASE_URL')).toBeUndefined();
  });

  it('trims a valid https URL', () => {
    expect(optionalBaseUrl('  https://api.example.test/v1  ', 'OPENAI_BASE_URL'))
      .toBe('https://api.example.test/v1');
  });

  it('accepts an http URL', () => {
    expect(optionalBaseUrl('http://llm-proxy.internal/v1', 'OPENAI_BASE_URL'))
      .toBe('http://llm-proxy.internal/v1');
  });

  it('rejects non-URL and non-http(s) values', () => {
    expect(() => optionalBaseUrl('not-a-url', 'ANTHROPIC_BASE_URL'))
      .toThrow(/ANTHROPIC_BASE_URL must be an http or https URL/);
    expect(() => optionalBaseUrl('ftp://api.example.test', 'OPENAI_BASE_URL'))
      .toThrow(/OPENAI_BASE_URL must be an http or https URL/);
  });
});

describe('provider base URL', () => {
  it('accepts an http OPENAI_BASE_URL', () => {
    const llm = createOpenAiProvider({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'http://localhost:8080',
    });
    expect(llm.name).toBe('openai');
  });

  it('accepts an http ANTHROPIC_BASE_URL', () => {
    const llm = createAnthropicProvider({
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_BASE_URL: 'http://localhost:8080',
    });
    expect(llm.name).toBe('anthropic');
  });

  it('accepts an http GOOGLE_BASE_URL', () => {
    const llm = createGeminiProvider({
      GOOGLE_API_KEY: 'sk-test',
      GOOGLE_BASE_URL: 'http://localhost:8080',
    });
    expect(llm.name).toBe('gemini');
  });
});
