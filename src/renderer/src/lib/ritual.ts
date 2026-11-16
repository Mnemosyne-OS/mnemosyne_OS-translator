/**
 * ritual.ts — what the screen says after asking the host to load a model
 * (doc 214 D4), without React, so every outcome is tested.
 *
 * Messages are i18n KEYS: the hook turns them into words.
 */

export interface RitualAnswer {
  loaded: boolean;
  cancelled: boolean;
  error: string | null;
}

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface RitualOutcome {
  status: ModelStatus;
  /** Make the picked engine the Translator's (only when it loaded). */
  adopt: boolean;
  /** An i18n key, or a raw sentence from the host (`error` set by LocalLoadModal is already worded). */
  error: { key: string } | { text: string } | null;
  /** Said once in the status line on success. */
  notice: string | null;
}

/**
 * The outcome of a ritual answer. `viaPlainLoad` = no board drew the dialog
 * (the cartridge sits in its own window) and the model was loaded WITHOUT the
 * memory check: it loads, and the person is told it skipped the check
 * (verifier pass 214, finding 1: it used to be silent).
 */
export function ritualOutcome(res: RitualAnswer, viaPlainLoad: boolean): RitualOutcome {
  if (res.loaded) {
    return { status: 'ready', adopt: true, error: null, notice: viaPlainLoad ? 'model.loadedNoRitual' : null };
  }
  if (res.cancelled) return { status: 'idle', adopt: false, error: null, notice: null };
  if (res.error === 'RITUAL_BUSY') return { status: 'error', adopt: false, error: { key: 'model.ritualBusy' }, notice: null };
  return { status: 'error', adopt: false, error: res.error ? { text: res.error } : { key: 'model.loadFailed' }, notice: null };
}

/** The key for a thrown bridge error during a load, or null to show the raw message. */
export function loadErrorKey(msg: string): string | null {
  if (/NOT_FROM_A_GESTURE/.test(msg)) return 'model.needsClick';
  if (/Unknown action|UNKNOWN_ACTION|not supported|No handler/i.test(msg)) return 'host.tooOld';
  return null;
}
