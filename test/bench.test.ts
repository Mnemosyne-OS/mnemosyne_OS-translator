/** The Compare bench runner and its model-free comparison (doc 214 §6). */
import {
  agreement, agreementPairs, charsPerSecond, lengthRatio, normalizeScenario, runScenario, wordDiff,
  type BenchEngine, type BenchPorts,
} from '../src/renderer/src/lib/bench';

const A: BenchEngine = { key: 'a', label: 'Model A', route: 'local', localModelId: 'm-a' };
const B: BenchEngine = { key: 'b', label: 'Model B', route: 'local', localModelId: 'm-b' };
const C: BenchEngine = { key: 'c', label: 'Cloud', route: 'cloud' };

/** Ports that record every call and advance a fake clock by 100 ms per step. */
function recorder(over: Partial<BenchPorts> = {}) {
  const calls: string[] = [];
  let clock = 0;
  let stop = false;
  const ports: BenchPorts = {
    freeIdle: async () => { calls.push('free'); clock += 100; return ['whisper']; },
    load: async (e) => { calls.push(`load:${e.key}`); clock += 1000; },
    translate: async (e, chunk, i) => { calls.push(`tr:${e.key}:${i}`); clock += 100; return `${e.key}(${chunk})`; },
    unload: async (e) => { calls.push(`unload:${e.key}`); clock += 100; },
    now: () => clock,
    stopped: () => stop,
    ...over,
  };
  return { calls, ports, stopNow: () => { stop = true; } };
}

describe('runScenario', () => {
  it('runs engines strictly one after the other: free, load, every piece, unload', async () => {
    const { calls, ports } = recorder();
    const runs = await runScenario({ engines: [A, B], freeBefore: true, unloadAfter: true }, ['x', 'y'], ports);
    expect(calls).toEqual([
      'free', 'load:a', 'tr:a:0', 'tr:a:1', 'unload:a',
      'free', 'load:b', 'tr:b:0', 'tr:b:1', 'unload:b',
    ]);
    expect(runs.map((r) => r.status)).toEqual(['done', 'done']);
    expect(runs[0]!.output).toBe('a(x)\n\na(y)');
    expect(runs[0]!.loadMs).toBe(1000);
    expect(runs[0]!.translateMs).toBe(200);
    expect(runs[0]!.freed).toEqual(['whisper']);
  });

  it('a cloud engine is neither freed for, loaded nor unloaded, and its load time is null (not 0)', async () => {
    const { calls, ports } = recorder();
    const [run] = await runScenario({ engines: [C], freeBefore: true, unloadAfter: true }, ['x'], ports);
    expect(calls).toEqual(['tr:c:0']);
    expect(run!.loadMs).toBeNull();
  });

  it('honours the two switches', async () => {
    const { calls, ports } = recorder();
    await runScenario({ engines: [A], freeBefore: false, unloadAfter: false }, ['x'], ports);
    expect(calls).toEqual(['load:a', 'tr:a:0']);
  });

  it('a failing load marks that engine and the pass goes on, without unloading what never loaded', async () => {
    const { calls, ports } = recorder({ load: async (e) => { calls.push(`load:${e.key}`); if (e.key === 'a') throw new Error('too big'); } });
    const runs = await runScenario({ engines: [A, B], freeBefore: false, unloadAfter: true }, ['x'], ports);
    expect(runs[0]!.status).toBe('error');
    expect(runs[0]!.error).toBe('too big');
    expect(calls).not.toContain('unload:a');
    expect(runs[1]!.status).toBe('done');
  });

  it('a failing piece keeps what was translated and still unloads', async () => {
    const { calls, ports } = recorder({
      translate: async (e, chunk, i) => { calls.push(`tr:${e.key}:${i}`); if (i === 1) throw new Error('boom'); return chunk; },
    });
    const [run] = await runScenario({ engines: [A], freeBefore: false, unloadAfter: true }, ['x', 'y', 'z'], ports);
    expect(run!.status).toBe('error');
    expect(run!.output).toBe('x');
    expect(run!.chunksDone).toBe(1);
    expect(calls).toContain('unload:a');
  });

  it('a failed free does not skip the engine', async () => {
    const { ports } = recorder({ freeIdle: async () => { throw new Error('nope'); } });
    const [run] = await runScenario({ engines: [A], freeBefore: true, unloadAfter: false }, ['x'], ports);
    expect(run!.status).toBe('done');
    expect(run!.freed).toBeNull();
  });

  it('stop is honoured between pieces and the rest is marked stopped', async () => {
    const rec = recorder();
    const translate = rec.ports.translate;
    rec.ports.translate = async (e, c, i, t) => { const out = await translate(e, c, i, t); if (i === 0) rec.stopNow(); return out; };
    const runs = await runScenario({ engines: [A, B], freeBefore: false, unloadAfter: true }, ['x', 'y'], rec.ports);
    expect(runs[0]!.status).toBe('stopped');
    expect(runs[0]!.chunksDone).toBe(1);
    expect(rec.calls).toContain('unload:a');
    expect(runs[1]!.status).toBe('stopped');
    expect(rec.calls).not.toContain('load:b');
  });
});

describe('comparison', () => {
  it('agreement is 1 for identical texts and 0 for disjoint ones', () => {
    expect(agreement('the cat sat', 'The cat sat')).toBe(1);
    expect(agreement('one two', 'three four')).toBe(0);
    expect(agreement('', '')).toBeNull();
  });
  it('agreement counts repeated words once per occurrence', () => {
    expect(agreement('a a b', 'a b b')).toBeCloseTo(4 / 6);
  });
  it('pairs every finished run', () => {
    const base = { route: 'local' as const, status: 'done' as const, phase: null, freed: null, loadMs: 1, translateMs: 1, chunksDone: 1, chunksTotal: 1, error: null, unloadFailed: false };
    const pairs = agreementPairs([
      { ...base, key: 'a', label: 'A', output: 'x y' },
      { ...base, key: 'b', label: 'B', output: 'x y' },
      { ...base, key: 'c', label: 'C', output: '' },
    ]);
    expect(pairs).toEqual([{ a: 'a', b: 'b', score: 1 }]);
  });
  it('speed and ratio are null when nothing was measured', () => {
    expect(charsPerSecond({ output: 'abcd', translateMs: 2000 })).toBe(2);
    expect(charsPerSecond({ output: 'abcd', translateMs: null })).toBeNull();
    expect(charsPerSecond({ output: '', translateMs: 10 })).toBeNull();
    expect(lengthRatio({ output: 'abcdef' }, 3)).toBe(2);
    expect(lengthRatio({ output: 'abc' }, 0)).toBeNull();
  });
  it('word diff marks what each side has alone', () => {
    expect(wordDiff('the big cat sat', 'the small cat sat down')).toEqual([
      { op: 'same', text: 'the' },
      { op: 'del', text: 'big' },
      { op: 'add', text: 'small' },
      { op: 'same', text: 'cat sat' },
      { op: 'add', text: 'down' },
    ]);
  });
  it('word diff refuses sides too long to compute', () => {
    expect(wordDiff('w '.repeat(4000), 'x')).toBeNull();
  });
});

describe('normalizeScenario', () => {
  it('keeps a valid scenario and drops broken engines', () => {
    const s = normalizeScenario({
      id: 's1', name: 'n', text: 't', engines: [A, { key: 'z', label: 'Z', route: 'local' }, { key: 'y' }, C],
    });
    expect(s!.engines.map((e) => e.key)).toEqual(['a', 'c']);
    expect(s!.freeBefore).toBe(true);
    expect(s!.unloadAfter).toBe(true);
  });
  it('rejects garbage', () => {
    expect(normalizeScenario({ id: 1 })).toBeNull();
    expect(normalizeScenario(null)).toBeNull();
  });
});
