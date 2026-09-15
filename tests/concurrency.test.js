import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
  createConcurrencyLimiter,
  normalizeConcurrency,
} from '../lib/concurrency.js';

describe('normalizeConcurrency', () => {
  it('defaults invalid values and clamps to 1–50', () => {
    expect(normalizeConcurrency(undefined)).toBe(DEFAULT_CONCURRENCY);
    expect(normalizeConcurrency('')).toBe(DEFAULT_CONCURRENCY);
    expect(normalizeConcurrency('nope')).toBe(DEFAULT_CONCURRENCY);
    expect(normalizeConcurrency(0)).toBe(MIN_CONCURRENCY);
    expect(normalizeConcurrency(99)).toBe(MAX_CONCURRENCY);
    expect(normalizeConcurrency('3')).toBe(3);
  });
});

describe('createConcurrencyLimiter', () => {
  function deferred() {
    /** @type {() => void} */
    let resolve = () => {};
    const promise = new Promise((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it('never runs more than max tasks at once and preserves result order', async () => {
    const { schedule } = createConcurrencyLimiter(2);
    let inFlight = 0;
    let peak = 0;
    const gates = [deferred(), deferred(), deferred()];
    let started = 0;

    const pending = [0, 1, 2].map((i) =>
      schedule(async () => {
        started += 1;
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gates[i].promise;
        inFlight -= 1;
        return i;
      }),
    );

    await vi.waitFor(() => expect(started).toBe(2));
    expect(peak).toBe(2);

    gates[0].resolve();
    await vi.waitFor(() => expect(started).toBe(3));
    gates[1].resolve();
    gates[2].resolve();

    await expect(Promise.all(pending)).resolves.toEqual([0, 1, 2]);
    expect(peak).toBe(2);
  });
});
