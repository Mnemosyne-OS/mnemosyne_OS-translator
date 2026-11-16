/**
 * Every key the code asks for exists in en, fr and es, and the three files
 * carry the same keys. A missing key renders its raw name on screen.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src', 'renderer', 'src');
const load = (lang: string) => JSON.parse(readFileSync(join(SRC, 'locales', `${lang}.json`), 'utf8')) as Record<string, string>;
const en = load('en');
const fr = load('fr');
const es = load('es');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(readFileSync(p, 'utf8'));
  }
  return out;
}

/** Keys built at runtime from a literal prefix, with their real values. */
const DYNAMIC: Record<string, string[]> = {
  'tab.': ['translate', 'documents', 'web', 'compare', 'vocab', 'history'],
  'docs.status.': ['queued', 'extracting', 'translating', 'done', 'error', 'stopped'],
  'bench.status.': ['pending', 'running', 'done', 'error', 'stopped'],
  'bench.phase.': ['free', 'load', 'translate', 'unload'],
  'runtime.kind.': ['llm', 'embed', 'embed-gpu', 'phrase-matte', 'wake', 'stt-local', 'stt-gpu', 'tts', 'ocr', 'img', 'img-rmbg', 'rerank', 'other'],
};

/** Keys handed to t() through a variable (lib/ritual returns keys), which the scan cannot read. */
const CHOSEN = ['model.loadedNoRitual', 'model.ritualBusy', 'model.loadFailed', 'model.needsClick', 'host.tooOld',
  'model.freedList', 'model.freedListGb', 'model.freedListAtLeast'];

function wanted(): Set<string> {
  const keys = new Set<string>();
  for (const code of sources(SRC)) {
    for (const m of code.matchAll(/\bt\(\s*'([^']+)'/g)) keys.add(m[1]!);
    for (const m of code.matchAll(/\btc\(\s*'([^']+)'/g)) ['one', 'many'].forEach((n) => keys.add(`${m[1]}.${n}`));
  }
  for (const [prefix, values] of Object.entries(DYNAMIC)) values.forEach((v) => keys.add(prefix + v));
  CHOSEN.forEach((k) => keys.add(k));
  return keys;
}

describe('locales', () => {
  it('every key used exists in English', () => {
    expect([...wanted()].filter((k) => !(k in en))).toEqual([]);
  });
  it('fr and es carry exactly the English keys', () => {
    const ref = Object.keys(en).sort();
    expect(Object.keys(fr).sort()).toEqual(ref);
    expect(Object.keys(es).sort()).toEqual(ref);
  });
  it('a placeholder of English survives in every language', () => {
    const vars = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(',');
    const broken = Object.keys(en).filter((k) => vars(en[k]!) !== vars(fr[k] ?? '') || vars(en[k]!) !== vars(es[k] ?? ''));
    expect(broken).toEqual([]);
  });
});
