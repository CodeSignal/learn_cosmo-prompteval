/**
 * Pure decision logic for the multi-session streaming registry.
 *
 * These helpers contain no DOM or SDK dependencies so they can be unit tested
 * directly (and bundled into the browser via public/app.js). All session state
 * lives in "runtime" objects shaped like:
 *   { sessionId, chat, lastStatus, ... }
 * where `chat` is an OctavusChat-like object exposing a `status` string.
 */

/** Maximum number of sessions allowed to stream a response simultaneously. */
export const MAX_CONCURRENT_STREAMS = 5;

/**
 * Count how many runtimes are currently streaming.
 * @param {Iterable<{ chat?: { status?: string } }>} runtimes - Any iterable of runtimes (e.g. a Map's values()).
 * @returns {number}
 */
export function streamingCount(runtimes) {
  let count = 0;
  for (const rt of runtimes ?? []) {
    if (rt?.chat?.status === 'streaming') count++;
  }
  return count;
}

/**
 * Whether the concurrency cap has been reached (no new streams may start).
 * @param {Iterable<{ chat?: { status?: string } }>} runtimes
 * @param {number} [max=MAX_CONCURRENT_STREAMS]
 * @returns {boolean}
 */
export function isStreamCapReached(runtimes, max = MAX_CONCURRENT_STREAMS) {
  return streamingCount(runtimes) >= max;
}

/**
 * Decide whether the composer is allowed to send a message right now. Mirrors
 * the gating used by the send button and the Enter-key handler.
 * @param {object} state
 * @param {boolean} state.hasActiveChat - An active session/chat exists.
 * @param {boolean} state.isUploading - A file upload is in flight.
 * @param {string} [state.activeStatus] - The active chat's status ('streaming' blocks send).
 * @param {number} state.streamingCount - Number of sessions currently streaming.
 * @param {number} [state.maxStreams=MAX_CONCURRENT_STREAMS] - Concurrency cap.
 * @param {boolean} state.hasText - The composer has non-empty text.
 * @param {boolean} state.hasReadyFile - The composer has a ready (uploaded) attachment.
 * @returns {boolean}
 */
export function canSendMessage({
  hasActiveChat,
  isUploading,
  activeStatus,
  streamingCount,
  maxStreams = MAX_CONCURRENT_STREAMS,
  hasText,
  hasReadyFile,
}) {
  if (!hasActiveChat || isUploading) return false;
  if (activeStatus === 'streaming') return false;
  if (streamingCount >= maxStreams) return false;
  return Boolean(hasText || hasReadyFile);
}

/**
 * The persistence action to take on a subscription tick, given the new status
 * and the previously seen status for the same runtime:
 *   • 'flush'    → write immediately (entering or leaving streaming).
 *   • 'throttle' → debounced partial save (mid-stream).
 *   • 'none'     → nothing to persist (idle → idle).
 * @param {string} status - Current chat status.
 * @param {string|null} lastStatus - Status from the previous tick.
 * @returns {'flush'|'throttle'|'none'}
 */
export function nextSaveAction(status, lastStatus) {
  if (status === 'streaming') {
    return lastStatus !== 'streaming' ? 'flush' : 'throttle';
  }
  if (lastStatus === 'streaming') return 'flush';
  return 'none';
}
