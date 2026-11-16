/**
 * prefs.ts — the settings the Translator keeps, and how an engine choice reads.
 *
 * Kept twice on purpose: in localStorage (instant at boot) and in the host's
 * durable state (doc 73), which survives the frame's origin changing AND is
 * what the far view drawn by the host reads (doc 214 §8, D10). The far view
 * maps `engine` with the same rules as `engineSpecOf` below.
 */
import { clampChunkChars, DEFAULT_CHUNK_CHARS } from './chunk';
import { normalizeProfile, type LangProfile } from './langProfile';

/** 'auto' | 'cloud' | 'local:<model id>' */
export type EngineChoice = string;

export interface TranslatorPrefs {
  profile: LangProfile;
  engine: EngineChoice;
  /** What the engine is called on screen, for the far view (it cannot list models itself cheaply). */
  engineLabel: string;
  /**
   * Unload idle engines (Whisper, TTS…) before loading a local model. ON by
   * default, decided 2026-11-10 (doc 214 §12, question 4): the loading dialog
   * then no longer shows what held the memory, and that is the choice made.
   */
  freeBeforeLoad: boolean;
  chunkChars: number;
}

export const PREFS_KEY = 'translator_prefs_v2';
/** The v1 engine key (1.3.x), read once to carry the choice over. */
export const LEGACY_ENGINE_KEY = 'translator_engine_v2';

/** Which route a choice takes. `local` alone (v1) means the app's active local model. */
export function engineSpecOf(choice: EngineChoice): { route: 'auto' | 'local' | 'cloud'; localModelId?: string } {
  if (choice.startsWith('local:') && choice.length > 'local:'.length) {
    return { route: 'local', localModelId: choice.slice('local:'.length) };
  }
  if (choice === 'local') return { route: 'local' };
  if (choice === 'cloud') return { route: 'cloud' };
  return { route: 'auto' };
}

export function isEngineChoice(v: unknown): v is EngineChoice {
  return typeof v === 'string' && (v === 'auto' || v === 'cloud' || v === 'local' || /^local:.+/.test(v));
}

/** Reads stored prefs defensively; anything missing takes its default. */
export function normalizePrefs(raw: unknown, uiLang: string, legacyEngine?: string | null): TranslatorPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const engine = isEngineChoice(r.engine) ? r.engine : isEngineChoice(legacyEngine) ? legacyEngine : 'auto';
  return {
    profile: normalizeProfile(r.profile, uiLang),
    engine,
    engineLabel: typeof r.engineLabel === 'string' ? r.engineLabel.slice(0, 120) : '',
    freeBeforeLoad: r.freeBeforeLoad !== false,
    chunkChars: r.chunkChars === undefined ? DEFAULT_CHUNK_CHARS : clampChunkChars(r.chunkChars),
  };
}
