import { describe, it, expect } from 'vitest';
import { formatDuration } from '../lib/format-duration.js';

describe('formatDuration', () => {
  it('returns empty for missing or invalid values', () => {
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(-1)).toBe('');
    expect(formatDuration('nope')).toBe('');
  });

  it('shows milliseconds under one second', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(847)).toBe('847ms');
  });

  it('shows compact seconds under a minute', () => {
    expect(formatDuration(1200)).toBe('1.2s');
    expect(formatDuration(4200)).toBe('4.2s');
    expect(formatDuration(10000)).toBe('10s');
    expect(formatDuration(12400)).toBe('12s');
    expect(formatDuration(59999)).toBe('1m');
  });

  it('shows minutes for longer runs', () => {
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(65000)).toBe('1m 5s');
  });
});
