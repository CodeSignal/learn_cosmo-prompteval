/**
 * Model Thinking capability detection for ChatCPT.
 *
 * Resolution order for `supportsThinking`:
 *   1. `noThinkingModels` denylist (config) → false
 *   2. `thinkingModels` allowlist (config) → true
 *   3. Generated capabilities map (`model-capabilities.json` / API)
 *   4. Octavus-aligned provider heuristics (last resort)
 *
 * The capabilities map is produced by `scripts/refresh-model-capabilities.mjs`
 * from OpenRouter `supported_parameters` / `reasoning` plus provider heuristics.
 * OpenRouter under-reports some models (e.g. Amazon Nova Premier) — force those
 * on with `thinkingModels` in chat-config.json.
 */

/** Strip the OpenRouter gateway prefix for comparisons. */
export function normalizeModelId(modelId = '') {
  return String(modelId).trim().replace(/^openrouter\//, '');
}

function idInList(modelId, list = []) {
  if (!Array.isArray(list) || list.length === 0) return false;
  const raw = String(modelId).trim();
  const norm = normalizeModelId(raw);
  return list.some((entry) => {
    const e = String(entry).trim();
    return e === raw || normalizeModelId(e) === norm;
  });
}

/**
 * Provider heuristics aligned with Octavus Thinking docs (Anthropic / OpenAI /
 * Google). Used when generating the capabilities snapshot and as a runtime
 * fallback when the map has no entry.
 */
export function providerHeuristicSupportsThinking(modelId = '') {
  const id = normalizeModelId(modelId);
  if (!id) return false;
  if (/^anthropic\/claude/.test(id)) return true;
  if (/^openai\/(o1|o3|o4|gpt-5)/.test(id)) return true;
  if (/^google\/gemini-(2\.5|3)/.test(id)) return true;
  return false;
}

/**
 * Whether an OpenRouter model entry advertises reasoning support.
 * @param {{ supported_parameters?: string[], reasoning?: unknown } | null | undefined} entry
 */
export function openRouterEntrySupportsThinking(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const params = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : [];
  if (params.includes('reasoning') || params.includes('include_reasoning')) return true;
  if (entry.reasoning != null && typeof entry.reasoning === 'object') return true;
  return false;
}

/**
 * Look up supportsThinking in a capabilities models map.
 * Tries the raw id, then the normalized (openrouter/-stripped) id, then a
 * reverse match with an openrouter/ prefix.
 * @param {string} modelId
 * @param {Record<string, { supportsThinking?: boolean }> | null | undefined} modelsMap
 * @returns {boolean | undefined} undefined when no entry is found
 */
export function supportsThinkingFromMap(modelId, modelsMap) {
  if (!modelsMap || typeof modelsMap !== 'object') return undefined;
  const raw = String(modelId).trim();
  if (!raw) return undefined;

  const direct = modelsMap[raw];
  if (direct && typeof direct.supportsThinking === 'boolean') return direct.supportsThinking;

  const norm = normalizeModelId(raw);
  if (norm !== raw) {
    const byNorm = modelsMap[norm];
    if (byNorm && typeof byNorm.supportsThinking === 'boolean') return byNorm.supportsThinking;
  }

  const prefixed = `openrouter/${norm}`;
  if (prefixed !== raw) {
    const byPrefixed = modelsMap[prefixed];
    if (byPrefixed && typeof byPrefixed.supportsThinking === 'boolean') {
      return byPrefixed.supportsThinking;
    }
  }

  // Scan for either raw or normalized key match (covers mixed map shapes).
  for (const [key, value] of Object.entries(modelsMap)) {
    if (key === raw || normalizeModelId(key) === norm) {
      if (value && typeof value.supportsThinking === 'boolean') return value.supportsThinking;
    }
  }

  return undefined;
}

/**
 * Whether the Thinking control should be available for this model.
 * @param {string} modelId
 * @param {{ thinkingModels?: string[], noThinkingModels?: string[] }} [config]
 * @param {Record<string, { supportsThinking?: boolean }> | null} [capabilitiesMap]
 */
export function supportsThinking(modelId, config = {}, capabilitiesMap = null) {
  const id = normalizeModelId(modelId);
  if (!id) return false;

  if (idInList(modelId, config.noThinkingModels)) return false;

  if (idInList(modelId, config.thinkingModels)) return true;

  const fromMap = supportsThinkingFromMap(modelId, capabilitiesMap);
  if (typeof fromMap === 'boolean') return fromMap;

  return providerHeuristicSupportsThinking(modelId);
}

/**
 * Build a per-model capabilities object for the models list, applying config
 * overrides on top of the loaded capabilities map.
 * @param {string[]} modelIds
 * @param {{ thinkingModels?: string[], noThinkingModels?: string[] }} [config]
 * @param {Record<string, { supportsThinking?: boolean }> | null} [capabilitiesMap]
 */
export function buildCapabilitiesPayload(modelIds, config = {}, capabilitiesMap = null) {
  const capabilities = {};
  for (const id of modelIds) {
    capabilities[id] = { supportsThinking: supportsThinking(id, config, capabilitiesMap) };
  }
  return capabilities;
}

/**
 * Load model-capabilities.json from disk (Node only). Missing/malformed files
 * yield an empty models map so callers can fall back to heuristics.
 * @param {string} filePath
 * @param {{ readFile?: (path: string, encoding: string) => Promise<string> }} [io]
 *   Optional fs-like reader (defaults to node:fs/promises). Inject in tests.
 * @returns {Promise<{ generatedAt: string | null, source: string, models: Record<string, { supportsThinking: boolean }> }>}
 */
export async function loadCapabilities(filePath, io = null) {
  try {
    const readFile = io?.readFile ?? (await import('node:fs/promises')).readFile;
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const models =
      parsed && typeof parsed.models === 'object' && parsed.models !== null ? parsed.models : {};
    return {
      generatedAt: typeof parsed?.generatedAt === 'string' ? parsed.generatedAt : null,
      source: typeof parsed?.source === 'string' ? parsed.source : 'unknown',
      models,
    };
  } catch {
    return { generatedAt: null, source: 'missing', models: {} };
  }
}
