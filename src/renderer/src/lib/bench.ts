/**
 * bench.ts — the "Compare" bench (doc 214 §6): several engines translate the
 * same text, one after the other, and the results are compared without a model.
 *
 * One pass, per engine, strictly in order (D7 — never two models at once):
 *   1. free   — unload the idle engines (Whisper, TTS, embedder…), local only;
 *   2. load   — load the model, timed (local only; a cloud engine has no load);
 *   3. translate — the SAME pieces, timed;
 *   4. unload — give the memory back before the next one (local only).
 *
 * The runner owns no I/O: every effect goes through `BenchPorts`, so the order
 * of operations, the timings and the failure handling are tested without a
 * host. A failing engine is marked with its reason and the pass goes on; a stop
 * is honoured between two pieces.
 *
 * 📏 A value that was not measured is `null`, never 0: a cloud engine's load
 * time is "nothing loaded", not "loaded in 0 s".
 */

export type EngineRoute = 'auto' | 'local' | 'cloud';

/** One engine of a scenario. `key` is stable and unique within the scenario. */
export interface BenchEngine {
  key: string;
  label: string;
  route: EngineRoute;
  /** Local only: the installed model to load. */
  localModelId?: string;
}

export interface Scenario {
  id: string;
  name: string;
  text: string;
  sourceLang: string;
  targetLang: string;
  engines: BenchEngine[];
  /** Unload the idle engines before each local model (default true). */
  freeBefore: boolean;
  /** Unload each local model once its turn is over (default true). */
  unloadAfter: boolean;
  chunkChars: number;
  createdAt: number;
}

export type RunPhase = 'free' | 'load' | 'translate' | 'unload';
export type RunStatus = 'pending' | 'running' | 'done' | 'error' | 'stopped';

export interface EngineRun {
  key: string;
  label: string;
  route: EngineRoute;
  status: RunStatus;
  phase: RunPhase | null;
  /** What `free` unloaded; null = not asked or not readable. */
  freed: string[] | null;
  loadMs: number | null;
  translateMs: number | null;
  chunksDone: number;
  chunksTotal: number;
  output: string;
  error: string | null;
  /** The unload after the turn failed (the run itself may be fine). */
  unloadFailed: boolean;
}

export interface BenchPorts {
  /** Unloads idle engines, returns their names. */
  freeIdle: () => Promise<string[]>;
  /** Loads a local engine; throws with the reason on failure. */
  load: (engine: BenchEngine) => Promise<void>;
  /** Translates one piece. */
  translate: (engine: BenchEngine, chunk: string, index: number, total: number) => Promise<string>;
  /** Unloads a local engine. */
  unload: (engine: BenchEngine) => Promise<void>;
  now: () => number;
  /** True once the person pressed Stop. */
  stopped: () => boolean;
}

/** The most engines one scenario runs: each local one may take minutes to load. */
export const MAX_ENGINES = 6;

export function emptyRun(engine: BenchEngine, chunksTotal: number): EngineRun {
  return {
    key: engine.key, label: engine.label, route: engine.route,
    status: 'pending', phase: null, freed: null, loadMs: null, translateMs: null,
    chunksDone: 0, chunksTotal, output: '', error: null, unloadFailed: false,
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs `scenario` over `chunks`. `onUpdate` receives a fresh copy of every
 * run after each step (for the screen). Returns the final runs.
 */
export async function runScenario(
  scenario: Pick<Scenario, 'engines' | 'freeBefore' | 'unloadAfter'>,
  chunks: string[],
  ports: BenchPorts,
  onUpdate: (runs: EngineRun[]) => void = () => {},
): Promise<EngineRun[]> {
  const engines = scenario.engines.slice(0, MAX_ENGINES);
  const runs = engines.map((e) => emptyRun(e, chunks.length));
  const emit = () => onUpdate(runs.map((r) => ({ ...r })));
  emit();

  for (let i = 0; i < engines.length; i++) {
    const engine = engines[i]!;
    const run = runs[i]!;
    if (ports.stopped()) {
      for (let j = i; j < runs.length; j++) runs[j]!.status = 'stopped';
      emit();
      break;
    }
    run.status = 'running';
    const local = engine.route === 'local';
    let loaded = false;

    if (local && scenario.freeBefore) {
      run.phase = 'free';
      emit();
      try {
        run.freed = await ports.freeIdle();
      } catch (err) {
        // Freeing is a courtesy to the load, never a reason to skip the engine.
        console.warn(`[bench] free before ${engine.label} failed:`, err);
        run.freed = null;
      }
    }

    try {
      if (local) {
        run.phase = 'load';
        emit();
        const t0 = ports.now();
        await ports.load(engine);
        run.loadMs = ports.now() - t0;
        loaded = true;
      }
      run.phase = 'translate';
      emit();
      const parts: string[] = [];
      const t0 = ports.now();
      for (let c = 0; c < chunks.length; c++) {
        if (ports.stopped()) {
          run.status = 'stopped';
          break;
        }
        parts.push(await ports.translate(engine, chunks[c]!, c, chunks.length));
        run.chunksDone = c + 1;
        run.output = parts.join('\n\n');
        emit();
      }
      run.translateMs = ports.now() - t0;
      if (run.status === 'running') run.status = 'done';
    } catch (err) {
      run.status = 'error';
      run.error = message(err);
    }

    if (local && loaded && scenario.unloadAfter) {
      run.phase = 'unload';
      emit();
      try {
        await ports.unload(engine);
      } catch (err) {
        console.warn(`[bench] unload of ${engine.label} failed:`, err);
        run.unloadFailed = true;
      }
    }
    run.phase = null;
    emit();
  }
  return runs.map((r) => ({ ...r }));
}

// ── Comparison without a model (D6) ─────────────────────────────────────────

/** Characters produced per second of translation; null when nothing was measured. */
export function charsPerSecond(run: Pick<EngineRun, 'output' | 'translateMs'>): number | null {
  if (!run.output || run.translateMs === null || run.translateMs <= 0) return null;
  return run.output.length / (run.translateMs / 1000);
}

/** Output length over source length; null without output or source. */
export function lengthRatio(run: Pick<EngineRun, 'output'>, sourceChars: number): number | null {
  if (!run.output || sourceChars <= 0) return null;
  return run.output.length / sourceChars;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

/**
 * Agreement between two translations: the Dice coefficient on word multisets,
 * 0..1. Two engines that say the same thing in the same words score near 1;
 * it measures agreement, NOT quality (two engines can agree on a mistake).
 * null when both are empty.
 */
export function agreement(a: string, b: string): number | null {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 && wb.length === 0) return null;
  const counts = new Map<string, number>();
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of wb) {
    const n = counts.get(w) ?? 0;
    if (n > 0) {
      common++;
      counts.set(w, n - 1);
    }
  }
  return (2 * common) / (wa.length + wb.length);
}

/** Every pair of finished runs with their agreement, in run order. */
export function agreementPairs(runs: EngineRun[]): Array<{ a: string; b: string; score: number | null }> {
  const done = runs.filter((r) => r.output);
  const out: Array<{ a: string; b: string; score: number | null }> = [];
  for (let i = 0; i < done.length; i++) {
    for (let j = i + 1; j < done.length; j++) {
      out.push({ a: done[i]!.key, b: done[j]!.key, score: agreement(done[i]!.output, done[j]!.output) });
    }
  }
  return out;
}

export type DiffOp = 'same' | 'add' | 'del';
export interface DiffPart { op: DiffOp; text: string }

/** Beyond this many words per side the word diff is not computed (O(n·m) memory). */
export const MAX_DIFF_WORDS = 3000;

/**
 * Word-level diff of `a` → `b` (longest common subsequence). `del` = only in
 * a, `add` = only in b. Returns null when a side is too long to diff.
 */
export function wordDiff(a: string, b: string): DiffPart[] | null {
  const ta = a.split(/\s+/).filter(Boolean);
  const tb = b.split(/\s+/).filter(Boolean);
  if (ta.length > MAX_DIFF_WORDS || tb.length > MAX_DIFF_WORDS) return null;
  const n = ta.length;
  const m = tb.length;
  const w = m + 1;
  const lcs = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = ta[i] === tb[j]
        ? lcs[(i + 1) * w + j + 1]! + 1
        : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (op: DiffOp, word: string) => {
    const last = parts[parts.length - 1];
    if (last && last.op === op) last.text += ` ${word}`;
    else parts.push({ op, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) { push('same', ta[i]!); i++; j++; }
    else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) { push('del', ta[i]!); i++; }
    else { push('add', tb[j]!); j++; }
  }
  while (i < n) push('del', ta[i++]!);
  while (j < m) push('add', tb[j++]!);
  return parts;
}

// ── Persistence ─────────────────────────────────────────────────────────────

/** Reads a stored scenario; anything unusable → null (dropped, never half-loaded). */
export function normalizeScenario(raw: unknown): Scenario | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.text !== 'string') return null;
  const engines: BenchEngine[] = [];
  if (Array.isArray(r.engines)) {
    for (const e of r.engines) {
      if (!e || typeof e !== 'object') continue;
      const o = e as Record<string, unknown>;
      const route = o.route === 'local' || o.route === 'cloud' || o.route === 'auto' ? o.route : null;
      if (typeof o.key !== 'string' || typeof o.label !== 'string' || !route) continue;
      if (route === 'local' && typeof o.localModelId !== 'string') continue;
      engines.push({ key: o.key, label: o.label, route, ...(route === 'local' ? { localModelId: o.localModelId as string } : {}) });
    }
  }
  return {
    id: r.id,
    name: r.name,
    text: r.text,
    sourceLang: typeof r.sourceLang === 'string' ? r.sourceLang : 'auto',
    targetLang: typeof r.targetLang === 'string' ? r.targetLang : 'en',
    engines: engines.slice(0, MAX_ENGINES),
    freeBefore: r.freeBefore !== false,
    unloadAfter: r.unloadAfter !== false,
    chunkChars: typeof r.chunkChars === 'number' ? r.chunkChars : 3500,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
  };
}
