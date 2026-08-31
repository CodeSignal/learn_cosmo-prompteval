/**
 * Serialize read-modify-write access to chat-sessions.json.
 *
 * Stream saves and session creates can overlap; without a queue, two handlers
 * can read the same snapshot and the later write drops the earlier change.
 */

/**
 * @param {() => Promise<unknown>} operation
 * @param {{ chain?: Promise<unknown> }} [state] - Mutable holder for the queue tip.
 * @returns {Promise<unknown>}
 */
export function enqueueSessionsWrite(operation, state = enqueueSessionsWrite) {
  const prev = state.chain ?? Promise.resolve();
  const run = prev.then(operation, operation);
  // Keep the chain alive after failures so later writes still run.
  state.chain = run.catch(() => {});
  return run;
}

enqueueSessionsWrite.chain = Promise.resolve();
