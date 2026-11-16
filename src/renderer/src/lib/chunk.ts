/**
 * chunk.ts — cut a long text into pieces a model translates whole (doc 214 D5).
 *
 * A whole document used to leave in ONE call capped at 8 192 tokens: a long
 * one came back cut, and nothing said so. Each piece is now a separate call,
 * which also gives a progress bar without streaming.
 *
 * Rules, in order:
 *   1. blocks are separated by blank lines and travel whole when they fit;
 *   2. a fenced code block (```) is never cut, even when longer than the limit
 *      (a half code block translates into garbage on both sides);
 *   3. a block longer than the limit is cut at sentence ends, then at spaces,
 *      and only as a last resort in the middle of a word.
 *
 * `joinChunks` puts translated pieces back with a blank line, the separator
 * every cut was made on.
 */

/** Default piece size in characters (~900 tokens for European languages). */
export const DEFAULT_CHUNK_CHARS = 3500;
/** Bounds the settings accept: below 500 a sentence loses its context, above 12 000 a small model truncates. */
export const MIN_CHUNK_CHARS = 500;
export const MAX_CHUNK_CHARS = 12_000;

/** Clamp a user-chosen size into the accepted bounds (non-numbers fall back to the default). */
export function clampChunkChars(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : DEFAULT_CHUNK_CHARS;
  return Math.min(MAX_CHUNK_CHARS, Math.max(MIN_CHUNK_CHARS, v));
}

/** Splits text into blank-line blocks, keeping each fenced code block as one block. */
function blocksOf(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  const flush = () => {
    if (cur.length && cur.some((l) => l.trim())) blocks.push(cur.join('\n'));
    cur = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!inFence) flush();
      cur.push(line);
      inFence = !inFence;
      if (!inFence) flush();
      continue;
    }
    if (!inFence && !line.trim()) {
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();
  return blocks;
}

/** Cuts one over-long prose block at sentence ends, then spaces, then hard. */
function cutBlock(block: string, max: number): string[] {
  const out: string[] = [];
  let rest = block;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let at = -1;
    const sentence = /[.!?。！？…]["»”')\]]?\s/g;
    let m: RegExpExecArray | null;
    while ((m = sentence.exec(window)) !== null) at = m.index + m[0].length;
    if (at < max * 0.3) {
      const space = window.lastIndexOf(' ');
      at = space > max * 0.3 ? space + 1 : max;
    }
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest.trim()) out.push(rest);
  return out;
}

/** Splits `text` into pieces of at most `maxChars` (code fences excepted). Empty text → []. */
export function splitIntoChunks(text: string, maxChars: number = DEFAULT_CHUNK_CHARS): string[] {
  const max = clampChunkChars(maxChars);
  const chunks: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur);
    cur = '';
  };
  for (const block of blocksOf(text)) {
    const isFence = /^\s*(```|~~~)/.test(block);
    if (block.length > max && !isFence) {
      push();
      const parts = cutBlock(block, max);
      // The last part may still share a piece with what follows.
      chunks.push(...parts.slice(0, -1));
      cur = parts[parts.length - 1] ?? '';
      continue;
    }
    if (!cur) cur = block;
    else if (cur.length + 2 + block.length <= max) cur += `\n\n${block}`;
    else {
      push();
      cur = block;
    }
  }
  push();
  return chunks;
}

/** Puts translated pieces back together on the separator every cut was made on. */
export function joinChunks(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join('\n\n');
}
