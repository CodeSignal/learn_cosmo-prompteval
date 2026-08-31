/**
 * Prefer Octavus `reasoning` parts. Some models/providers still stream
 * chain-of-thought as `<thinking>…</thinking>` / `<think>…</think>` inside
 * the text channel with no separate reasoning part — peel those as a fallback.
 *
 * Tags inside fenced or inline Markdown code are left alone so educational
 * answers that explain the tags are not mangled.
 */

/**
 * Split Markdown into code vs plain-text segments (fenced ```/~~~ and inline `…`).
 * @param {string} text
 * @returns {{ type: 'code' | 'text', value: string }[]}
 */
export function splitMarkdownCodeSegments(text) {
  if (!text) return [];
  // Unterminated fences (common while streaming) count as code through EOF.
  const re = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`)/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return parts;
}

/**
 * Peel thinking tags from a plain-text region (no Markdown code).
 * Handles an unclosed open tag while the thought is still streaming.
 * @param {string} text
 * @returns {{ reasoning: string, answer: string, thinkingOpen: boolean }}
 */
function extractThinkingFromPlainText(text) {
  if (!text) return { reasoning: '', answer: '', thinkingOpen: false };

  const completeRe = /<(thinking|think)>([\s\S]*?)<\/\1>/gi;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = completeRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'thinking', value: match[2] });
    lastIndex = match.index + match[0].length;
  }

  const rest = text.slice(lastIndex);
  const openMatch = /<(thinking|think)>([\s\S]*)$/i.exec(rest);
  let thinkingOpen = false;
  if (openMatch) {
    if (openMatch.index > 0) {
      parts.push({ type: 'text', value: rest.slice(0, openMatch.index) });
    }
    parts.push({ type: 'thinking', value: openMatch[2] });
    thinkingOpen = true;
  } else if (rest) {
    parts.push({ type: 'text', value: rest });
  }

  const answer = parts
    .filter((p) => p.type === 'text')
    .map((p) => p.value)
    .join('');
  const startsWithThinking = parts.length > 0 && parts[0].type === 'thinking';

  return {
    reasoning: parts
      .filter((p) => p.type === 'thinking')
      .map((p) => p.value)
      .join('\n\n')
      .trim(),
    // Only drop the blank line after a leading thinking block; keep indented answers intact.
    answer: startsWithThinking ? answer.replace(/^(?:\r?\n)+/, '') : answer,
    thinkingOpen,
  };
}

/**
 * Extract embedded thinking tags from assistant text, ignoring Markdown code.
 * @param {string} text
 * @returns {{ reasoning: string, answer: string, thinkingOpen: boolean }}
 */
export function extractEmbeddedThinking(text) {
  if (!text) return { reasoning: '', answer: '', thinkingOpen: false };

  const segments = splitMarkdownCodeSegments(text);
  const reasoningChunks = [];
  const answerChunks = [];
  let thinkingOpen = false;
  let sawLeadingThinking = false;
  let sawContent = false;

  for (const seg of segments) {
    if (seg.type === 'code') {
      if (seg.value) sawContent = true;
      answerChunks.push(seg.value);
      continue;
    }
    const extracted = extractThinkingFromPlainText(seg.value);
    if (extracted.reasoning) reasoningChunks.push(extracted.reasoning);
    if (extracted.thinkingOpen) thinkingOpen = true;
    if (!sawContent && extracted.reasoning && !extracted.answer.trim()) {
      sawLeadingThinking = true;
    }
    if (extracted.reasoning || extracted.answer) sawContent = true;
    answerChunks.push(extracted.answer);
  }

  let answer = answerChunks.join('');
  if (sawLeadingThinking) {
    answer = answer.replace(/^(?:\r?\n)+/, '');
  }

  return {
    reasoning: reasoningChunks.join('\n\n').trim(),
    answer,
    thinkingOpen,
  };
}

/**
 * Split assistant parts into reasoning vs text segments, preserving thought
 * boundaries. Octavus opens a fresh `reasoning` part per thought and streams
 * deltas into it — those boundaries feed the Thoughts section (one DIV each).
 * Consecutive text parts are merged so Markdown spanning them (e.g. a list)
 * stays intact. Empty finished segments are dropped; a still-streaming
 * reasoning part is kept for the "Thinking…" state.
 *
 * @param {{ type?: string, text?: string, status?: string }[]} parts
 * @returns {{ kind: 'reasoning' | 'text', text: string, streaming: boolean }[]}
 */
export function segmentAssistantParts(parts = []) {
  const segments = [];

  for (const part of parts) {
    if (part?.type === 'reasoning') {
      segments.push({
        kind: 'reasoning',
        text: part.text ?? '',
        streaming: part.status === 'streaming' || part.status === 'pending',
      });
    } else if (part?.type === 'text') {
      const last = segments[segments.length - 1];
      if (last?.kind === 'text') last.text += part.text ?? '';
      else segments.push({ kind: 'text', text: part.text ?? '', streaming: false });
    }
  }

  return segments.filter((seg) => seg.text.trim().length > 0 || seg.streaming);
}

/**
 * Resolve what to show as Thoughts vs answer.
 * Octavus `reasoning` parts win; tagged-text peel is only a fallback.
 *
 * @param {{ text?: string, reasoningFromParts?: string, reasoningStreaming?: boolean }} opts
 * @returns {{ reasoning: string, answer: string, thinkingOpen: boolean, source: 'octavus' | 'embedded' | 'none' }}
 */
export function resolveAssistantContent({
  text = '',
  reasoningFromParts = '',
  reasoningStreaming = false,
} = {}) {
  if (reasoningStreaming || (reasoningFromParts && reasoningFromParts.trim())) {
    return {
      reasoning: reasoningFromParts,
      answer: text,
      thinkingOpen: false,
      source: 'octavus',
    };
  }

  const embedded = extractEmbeddedThinking(text);
  const used = Boolean(embedded.reasoning || embedded.thinkingOpen);
  return {
    reasoning: embedded.reasoning,
    answer: embedded.answer,
    thinkingOpen: embedded.thinkingOpen,
    source: used ? 'embedded' : 'none',
  };
}
