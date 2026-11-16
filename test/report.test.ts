/** The Markdown a web page and a bench pass leave behind (doc 214 §6, §7). */
import { benchReportMarkdown, webReportMarkdown } from '../src/renderer/src/lib/report';
import { normalizePrefs, engineSpecOf } from '../src/renderer/src/lib/prefs';
import type { EngineRun } from '../src/renderer/src/lib/bench';

const webLabels = {
  heading: 'Translation', address: 'Address', readOn: 'Read on', published: 'Published', engine: 'Engine',
  pieces: 'pieces', truncated: 'cut', translatedText: 'Translated text', original: 'Original',
};

describe('webReportMarkdown', () => {
  const base = {
    url: 'https://example.org/a', title: 'Hola', published: null, sourceLang: 'es', targetLang: 'en',
    engineLabel: 'Local · Qwen', readAt: Date.UTC(2026, 10, 10), chunks: 3, translated: 'Hello', original: 'Hola', truncated: false,
  };
  it('carries the title, the address, the date, the engine, both texts', () => {
    const md = webReportMarkdown(base, webLabels);
    expect(md).toContain('# Hola');
    expect(md).toContain('- Address: https://example.org/a');
    expect(md).toContain('- Read on: 2026-11-10');
    expect(md).toContain('Local · Qwen · es → en · 3 pieces');
    expect(md).toContain('## Translated text\n\nHello');
    expect(md).toContain('<details><summary>Original</summary>');
    expect(md).not.toContain('Published');
    expect(md).not.toContain('⚠');
  });
  it('falls back to the address without a title, and says when the page was cut', () => {
    const md = webReportMarkdown({ ...base, title: null, truncated: true }, webLabels);
    expect(md).toContain('# https://example.org/a');
    expect(md).toContain('- ⚠ cut');
  });
});

describe('benchReportMarkdown', () => {
  const run = (key: string, over: Partial<EngineRun>): EngineRun => ({
    key, label: key.toUpperCase(), route: 'local', status: 'done', phase: null, freed: null,
    loadMs: 2000, translateMs: 1000, chunksDone: 1, chunksTotal: 1, output: 'a b c', error: null, unloadFailed: false, ...over,
  });
  const labels = {
    heading: 'Bench', engine: 'Engine', status: 'State', load: 'Load', translate: 'Tr', speed: 'cps', ratio: 'len',
    agreement: 'Agreement', output: 'Outputs', notMeasured: '—',
    statuses: { pending: 'p', running: 'r', done: 'ok', error: 'ko', stopped: 's' },
  };
  it('one row per engine, null measures shown as not measured, never 0', () => {
    const md = benchReportMarkdown('S', 'en', 'es', 5, [run('a', {}), run('c', { route: 'cloud', loadMs: null })], labels, 0);
    expect(md).toContain('| A | ok | 2.0 s | 1.0 s | 5 | 1.00 |');
    expect(md).toContain('| C | ok | — | 1.0 s |');
    expect(md).toContain('- A ↔ C: 100 %');
    expect(md).toContain('### A');
  });
  it('an error keeps its reason in the row without breaking the table', () => {
    const md = benchReportMarkdown('S', 'en', 'es', 5, [run('a', { status: 'error', error: 'x|y', output: '' })], labels, 0);
    expect(md).toContain('| A | ko (x/y) |');
    expect(md).not.toContain('## Agreement');
  });
});

describe('prefs', () => {
  it('reads an engine choice into a route', () => {
    expect(engineSpecOf('local:qwen3-4b')).toEqual({ route: 'local', localModelId: 'qwen3-4b' });
    expect(engineSpecOf('local')).toEqual({ route: 'local' });
    expect(engineSpecOf('cloud')).toEqual({ route: 'cloud' });
    expect(engineSpecOf('nonsense')).toEqual({ route: 'auto' });
  });
  it('carries the v1 engine over and defaults the rest', () => {
    const p = normalizePrefs(null, 'fr', 'local:abc');
    expect(p.engine).toBe('local:abc');
    expect(p.freeBeforeLoad).toBe(true);
    expect(p.chunkChars).toBe(3500);
    expect(p.profile.mine[0]).toBe('fr');
  });
  it('a stored engine wins over the legacy one, a bad one does not', () => {
    expect(normalizePrefs({ engine: 'cloud' }, 'en', 'local:x').engine).toBe('cloud');
    expect(normalizePrefs({ engine: 42 }, 'en', null).engine).toBe('auto');
  });
});
