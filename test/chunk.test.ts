/** Pieces of a long text (doc 214 D5). */
import { clampChunkChars, joinChunks, splitIntoChunks, MIN_CHUNK_CHARS } from '../src/renderer/src/lib/chunk';
import { buildTranslatePrompt, cleanTranslation, isEcho } from '../src/renderer/src/lib/translatePrompt';

const para = (n: number, len = 400) => `Paragraph ${n}. ` + 'word '.repeat(Math.ceil(len / 5)).trim() + '.';

describe('splitIntoChunks', () => {
  it('keeps a short text whole', () => {
    expect(splitIntoChunks('Hello.\n\nWorld.', 3500)).toEqual(['Hello.\n\nWorld.']);
  });
  it('packs paragraphs up to the limit and never loses one', () => {
    const text = Array.from({ length: 20 }, (_, i) => para(i)).join('\n\n');
    const chunks = splitIntoChunks(text, 1000);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
    expect(joinChunks(chunks)).toBe(text);
  });
  it('never cuts a fenced code block, even past the limit', () => {
    const code = '```js\n' + 'const a = 1;\n'.repeat(80) + '```';
    const text = `${para(1)}\n\n${code}\n\n${para(2)}`;
    const chunks = splitIntoChunks(text, 600);
    expect(chunks.some((c) => c === code)).toBe(true);
  });
  it('keeps blank lines inside a fence as part of the fence', () => {
    const code = '```\nline 1\n\nline 3\n```';
    expect(splitIntoChunks(`${code}\n\nafter`, 3500)).toEqual([`${code}\n\nafter`]);
  });
  it('cuts an over-long paragraph at sentence ends', () => {
    const sentence = 'This is one sentence that has some length to it. ';
    const block = sentence.repeat(40).trim();
    const chunks = splitIntoChunks(block, 600);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(600);
      expect(c.endsWith('.')).toBe(true);
    }
  });
  it('returns nothing for an empty text', () => {
    expect(splitIntoChunks('  \n\n  ')).toEqual([]);
  });
});

describe('clampChunkChars', () => {
  it('holds the bounds and falls back on garbage', () => {
    expect(clampChunkChars(10)).toBe(MIN_CHUNK_CHARS);
    expect(clampChunkChars(99_999)).toBe(12_000);
    expect(clampChunkChars('x')).toBe(3500);
  });
});

describe('translate prompt', () => {
  it('names both languages and wraps the text in sentinels', () => {
    const p = buildTranslatePrompt('Hola', 'es', 'en');
    expect(p.systemPrompt).toContain('from Spanish into English');
    // The order sits right before the text: a small model ignores it in the system prompt.
    expect(p.prompt).toBe('Translate this Spanish text into English. Output only the English translation.\n⟦SOURCE⟧\nHola\n⟦END⟧');
    expect(buildTranslatePrompt('x', 'auto', 'fr').prompt.startsWith('Translate this text into French.')).toBe(true);
  });
  it('keeps the answer after a lone </think>, the trace LFM3 leaks at budget 0', () => {
    expect(cleanTranslation('So I translate each line.\n</think>The branch is merged.')).toBe('The branch is merged.');
    expect(cleanTranslation('<think>a</think>Hello </think> world')).toBe('world');
  });
  it('keeps the whole text when what follows a lone </think> is a cut fragment', () => {
    const full = 'The branch is merged into main. Nothing has been pushed. What was entered: 3 files.';
    expect(cleanTranslation(`${full}\nLet me check.</think>The branch is`, full.length)).toBe(`${full}\nLet me check.The branch is`);
  });
  it('drops a closing courtesy line', () => {
    expect(cleanTranslation('The branch is merged.\n\nLet me know if you need anything else.')).toBe('The branch is merged.');
  });
  it('calls a copy of the source an echo, quotes and spacing aside, never a short one', () => {
    const fr = 'Rien n’est poussé, la branche est « propre ».';
    expect(isEcho(fr, "Rien n'est  poussé, la branche est \"propre\".")).toBe(true);
    expect(isEcho(fr, 'Nothing is pushed, the branch is clean.')).toBe(false);
    expect(isEcho('Paris, OK', 'Paris, OK')).toBe(false);
  });
  it('tells a piece it is one of several, and only then', () => {
    expect(buildTranslatePrompt('x', 'auto', 'fr', { index: 1, total: 3 }).systemPrompt).toContain('part 2 of 3');
    expect(buildTranslatePrompt('x', 'auto', 'fr', { index: 0, total: 1 }).systemPrompt).not.toContain('part 1 of 1');
  });
  it('cleans echoed sentinels, a reasoning block and a preamble', () => {
    expect(cleanTranslation('<think>hmm</think>⟦SOURCE⟧\nHere is the translation:\nBonjour\n⟦END⟧')).toBe('Bonjour');
  });
});
