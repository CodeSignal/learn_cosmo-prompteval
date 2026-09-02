import { describe, it, expect } from 'vitest';
import { optionalHttpsBaseUrl } from '../lib/llm/base-url.js';
import { createOpenAiProvider } from '../lib/llm/openai.js';
import { createAnthropicProvider } from '../lib/llm/anthropic.js';

describe('optionalHttpsBaseUrl', () => {
  it('returns undefined for absent or blank values', () => {
    expect(optionalHttpsBaseUrl(undefined, 'OPENAI_BASE_URL')).toBeUndefined();
    expect(optionalHttpsBaseUrl('', 'OPENAI_BASE_URL')).toBeUndefined();
    expect(optionalHttpsBaseUrl('   ', 'OPENAI_BASE_URL')).toBeUndefined();
  });

  it('trims a valid https URL', () => {
    expect(optionalHttpsBaseUrl('  https://api.example.test/v1  ', 'OPENAI_BASE_URL'))
      .toBe('https://api.example.test/v1');
  });

  it('rejects http and non-URL values', () => {
    expect(() => optionalHttpsBaseUrl('http://api.example.test', 'OPENAI_BASE_URL'))
      .toThrow(/OPENAI_BASE_URL must use HTTPS/);
    expect(() => optionalHttpsBaseUrl('not-a-url', 'ANTHROPIC_BASE_URL'))
      .toThrow(/ANTHROPIC_BASE_URL must be an https URL/);
  });
});

describe('provider base URL guards', () => {
  it('rejects a non-HTTPS OPENAI_BASE_URL before constructing the client', () => {
    expect(() => createOpenAiProvider({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'http://localhost:8080',
    })).toThrow(/OPENAI_BASE_URL must use HTTPS/);
  });

  it('rejects a non-HTTPS ANTHROPIC_BASE_URL before constructing the client', () => {
    expect(() => createAnthropicProvider({
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_BASE_URL: 'http://localhost:8080',
    })).toThrow(/ANTHROPIC_BASE_URL must use HTTPS/);
  });
});
