/**
 * runtimeNames.ts — the engines the host unloads, in words, and how much
 * memory they gave back (doc 214 §4: « with the GB given back »).
 *
 * The host names a resident engine by id (`llm`, `embed-gpu`, `tts:xtts`…)
 * and its weight by `approxBytes`, which may be null (not every engine knows
 * it). 📏 Unknown is not zero: the sum says « at least » when one of the
 * engines had no figure, and nothing when none had one.
 */

/** The i18n key naming an engine id (`tts:xtts` → the `tts` family). */
export function runtimeKindKey(id: string): string {
  const family = id.split(':')[0] ?? id;
  const KNOWN = ['llm', 'embed', 'embed-gpu', 'phrase-matte', 'wake', 'stt-local', 'stt-gpu', 'tts', 'tts-neural', 'ocr', 'img', 'img-rmbg', 'rerank'];
  return KNOWN.includes(family) ? `runtime.kind.${family === 'tts-neural' ? 'tts' : family}` : 'runtime.kind.other';
}

export interface FreedSummary {
  /** One key per unloaded engine, in order, duplicates removed. */
  keys: string[];
  /** Bytes given back by the engines whose weight was known; null when none was. */
  bytes: number | null;
  /** At least one unloaded engine had no known weight: `bytes` is a floor. */
  partial: boolean;
}

/** Summarises what an unload gave back, from the list read just before it. */
export function freedSummary(unloaded: string[], before: Array<{ id: string; approxBytes: number | null }> | null): FreedSummary {
  const keys: string[] = [];
  for (const id of unloaded) {
    const k = runtimeKindKey(id);
    if (!keys.includes(k)) keys.push(k);
  }
  let bytes = 0;
  let known = 0;
  for (const id of unloaded) {
    const b = before?.find((r) => r.id === id)?.approxBytes;
    if (typeof b === 'number' && b > 0) {
      bytes += b;
      known++;
    }
  }
  return { keys, bytes: known > 0 ? bytes : null, partial: known > 0 && known < unloaded.length };
}

/** Gigabytes with one decimal, for the status line. */
export function gbText(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}
