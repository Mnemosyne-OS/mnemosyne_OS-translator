/**
 * langProfile.ts — "my languages" (doc 214 §9).
 *
 * A person who speaks Spanish, English and French and keeps switching between
 * English and Spanish should not open two dropdowns per sentence. The profile
 * holds the languages they speak (`mine`, in order of preference) and the PAIR
 * they switch between most. The target is then chosen from what the source is:
 *
 *   - source is one side of the pair   → the other side;
 *   - source is another of my languages → the first of mine that is not it;
 *   - source is foreign                 → the first of mine;
 *   - source unknown                    → the current target stays.
 *
 * Detection is a local function-word count, no model: "I don't know" is a
 * real answer (null) and leaves the target alone rather than guessing.
 */
import { LANGUAGES } from './store';

export interface LangProfile {
  /** Languages the person speaks, most used first. Never empty after `normalizeProfile`. */
  mine: string[];
  /** The two languages switched between most. Both are in `mine`. */
  pair: [string, string];
}

const KNOWN = new Set(LANGUAGES.map((l) => l.code));

/** First-run profile: the interface language plus English (or Spanish when the interface is English). */
export function defaultProfile(uiLang: string): LangProfile {
  const ui = KNOWN.has(uiLang) ? uiLang : 'en';
  const other = ui === 'en' ? 'es' : 'en';
  return { mine: [ui, other], pair: [other, ui] };
}

/**
 * Reads a stored profile defensively: unknown codes and duplicates are dropped,
 * a pair outside `mine` is rebuilt from `mine`. Anything unreadable falls back
 * to the default — a broken blob must not leave the app without a target.
 */
export function normalizeProfile(raw: unknown, uiLang: string): LangProfile {
  const fallback = defaultProfile(uiLang);
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as { mine?: unknown; pair?: unknown };
  const mine: string[] = [];
  if (Array.isArray(r.mine)) {
    for (const c of r.mine) if (typeof c === 'string' && KNOWN.has(c) && !mine.includes(c)) mine.push(c);
  }
  if (mine.length === 0) return fallback;
  if (mine.length === 1) mine.push(mine[0] === 'en' ? 'es' : 'en');
  let pair: [string, string] = [mine[0]!, mine[1]!];
  if (Array.isArray(r.pair) && r.pair.length === 2) {
    const [a, b] = r.pair;
    if (typeof a === 'string' && typeof b === 'string' && a !== b && mine.includes(a) && mine.includes(b)) pair = [a, b];
  }
  return { mine, pair };
}

/**
 * Adds or removes one language from `mine`. Removing is refused below two
 * languages (a pair needs two). The pair is repaired when it lost a side.
 */
export function toggleMine(profile: LangProfile, code: string): LangProfile {
  if (!KNOWN.has(code)) return profile;
  const has = profile.mine.includes(code);
  if (has && profile.mine.length <= 2) return profile;
  const mine = has ? profile.mine.filter((c) => c !== code) : [...profile.mine, code];
  const pairOk = mine.includes(profile.pair[0]) && mine.includes(profile.pair[1]);
  return { mine, pair: pairOk ? profile.pair : [mine[0]!, mine[1]!] };
}

/** Moves a language one place earlier in `mine` (the order is the preference). */
export function promoteMine(profile: LangProfile, code: string): LangProfile {
  const i = profile.mine.indexOf(code);
  if (i <= 0) return profile;
  const mine = [...profile.mine];
  [mine[i - 1], mine[i]] = [mine[i]!, mine[i - 1]!];
  return { ...profile, mine };
}

/** Sets the pair. Both must be distinct members of `mine`, otherwise nothing changes. */
export function setPair(profile: LangProfile, a: string, b: string): LangProfile {
  if (a === b || !profile.mine.includes(a) || !profile.mine.includes(b)) return profile;
  return { ...profile, pair: [a, b] };
}

/**
 * The target for a source, by the rules in the module comment.
 * `source` is a code or null (unknown / not detected yet).
 */
export function pickTarget(profile: LangProfile, source: string | null, currentTarget: string): string {
  if (!source) return currentTarget;
  const [a, b] = profile.pair;
  if (source === a) return b;
  if (source === b) return a;
  if (profile.mine.includes(source)) return profile.mine.find((c) => c !== source) ?? currentTarget;
  return profile.mine[0] ?? currentTarget;
}

/**
 * A click on one of "my languages" chips: it becomes the target. Clicking the
 * chip that already is the target swaps source and target when the source is
 * known (the en⇄es reflex), and does nothing on an auto source.
 */
export function chipTarget(
  source: string,
  target: string,
  code: string,
): { source: string; target: string } {
  if (code !== target) return { source: source === code ? target : source, target: code };
  if (source === 'auto') return { source, target };
  return { source: target, target: source };
}

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Frequent function words per language. A word shared by two languages (`una`,
 * `para`) counts for both, so it adds to both scores and decides nothing; the
 * words that decide are the ones only one language uses. Accented letters are
 * the strongest signal between French, Spanish and Portuguese (bonus below).
 */
const MARKERS: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'are', 'was', 'of', 'to', 'with', 'that', 'this', 'it', 'you', 'have', 'for', 'not', 'what', 'which', 'would'],
  fr: ['le', 'les', 'des', 'est', 'et', 'une', 'du', 'dans', 'pour', 'pas', 'qui', 'avec', 'sur', 'je', 'nous', 'vous', 'être', 'très', 'à', 'où', 'ça', 'c\'est'],
  es: ['el', 'los', 'las', 'es', 'y', 'una', 'del', 'en', 'para', 'con', 'por', 'pero', 'muy', 'yo', 'está', 'qué', 'cómo', 'también'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'mit', 'auf', 'ich', 'sie', 'wir', 'für', 'auch', 'sich'],
  it: ['il', 'gli', 'della', 'è', 'e', 'non', 'che', 'una', 'per', 'con', 'sono', 'questo', 'anche', 'molto', 'perché'],
  pt: ['o', 'os', 'as', 'é', 'e', 'não', 'uma', 'do', 'da', 'em', 'para', 'com', 'você', 'também', 'muito', 'são'],
};

/** Script ranges decide at once: no function word needed for these. */
const SCRIPTS: Array<[string, RegExp]> = [
  ['ru', /[Ѐ-ӿ]/],
  ['ar', /[؀-ۿ]/],
  ['hi', /[ऀ-ॿ]/],
  ['ja', /[぀-ヿ]/],
  ['ko', /[가-힯]/],
  ['zh', /[一-鿿]/],
];

/**
 * Best guess of the language of `text`, or null when the evidence is too thin
 * (fewer than 2 marker hits, or a tie). Never throws. The far view drawn by the
 * host uses the same floor (`translatorFarModel.detectFarLang`): with 3 here,
 * « Where is the station? » was English far away and unknown up close.
 */
export function detectLang(text: string): string | null {
  const sample = text.slice(0, 4000);
  if (!sample.trim()) return null;
  for (const [code, re] of SCRIPTS) {
    const hits = sample.match(new RegExp(re.source, 'g'))?.length ?? 0;
    if (hits >= 2) return code;
  }
  const words = sample.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length === 0) return null;
  const scores: Record<string, number> = {};
  for (const [code, list] of Object.entries(MARKERS)) {
    const set = new Set(list);
    let s = 0;
    for (const w of words) if (set.has(w)) s++;
    // Letters only one language uses tip close calls.
    if (code === 'es' && /ñ|¿|¡/.test(sample)) s += 3;
    if (code === 'fr' && /[èêëçœ]|\bl'|\bd'|\bqu'/.test(sample.toLowerCase())) s += 2;
    if (code === 'pt' && /ã|õ|ç[ãõ]/.test(sample)) s += 3;
    if (code === 'de' && /ß|[äöü]/.test(sample)) s += 2;
    scores[code] = s;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best || best[1] < 2) return null;
  if (second && second[1] === best[1]) return null;
  return best[0];
}
