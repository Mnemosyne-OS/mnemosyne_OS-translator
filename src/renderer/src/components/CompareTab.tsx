/**
 * CompareTab — the bench (doc 214 §6): one text, 2 to 6 engines, run strictly
 * one after the other (free → load → translate → unload), then compared
 * without a model: times, speed, length, agreement, side by side, word diff.
 *
 * Scenarios are kept in localStorage (they can hold a whole document, too big
 * for the host's 256 KB durable state). Results live with the screen and leave
 * as a report (file or chat).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { langLabel, t } from '../i18n';
import type { TranslatorBridge } from '../hooks/useBridge';
import type { ModelApi } from '../hooks/useModel';
import {
  MAX_ENGINES, agreementPairs, charsPerSecond, emptyRun, lengthRatio, normalizeScenario, runScenario, wordDiff,
  type BenchEngine, type BenchPorts, type EngineRun, type Scenario,
} from '../lib/bench';
import { splitIntoChunks } from '../lib/chunk';
import { detectLang } from '../lib/langProfile';
import { benchReportMarkdown } from '../lib/report';
import { hashString, LANGUAGES } from '../lib/store';
import { downloadText } from '../lib/text';
import { chatError, chatSent } from '../lib/errors';
import { runtimeKindKey } from '../lib/runtimeNames';
import { CopyButton, Empty, InfinityLoader, Progress } from './Bits';
import { Icon } from './icons';

const SCENARIOS_KEY = 'translator_scenarios_v1';
const MAX_SCENARIOS = 20;

function loadScenarios(): Scenario[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SCENARIOS_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(normalizeScenario).filter((s): s is Scenario => s !== null) : [];
  } catch (err) {
    console.warn('[Translator] saved scenarios unreadable:', err);
    return [];
  }
}

function saveScenarios(list: Scenario[]): boolean {
  try {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(list.slice(0, MAX_SCENARIOS)));
    return true;
  } catch (err) {
    console.warn('[Translator] scenarios not saved (storage full?):', err);
    return false;
  }
}

function secs(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`;
}

interface Props {
  bridge: TranslatorBridge;
  model: ModelApi;
  chunkChars: number;
  source: string;
  target: string;
  notify: (msg: string, kind: 'error' | 'success') => void;
  /** Told when a pass starts and ends: the other tabs wait meanwhile. */
  onRunning: (running: boolean) => void;
  /** Another tab is translating: a pass would measure its loads, so it waits. */
  blocked: boolean;
}

export function CompareTab({ bridge, model, chunkChars, source, target, notify, onRunning, blocked }: Props) {
  const [saved, setSaved] = useState<Scenario[]>(loadScenarios);
  const [draft, setDraft] = useState<Scenario>(() => ({
    id: `sc-${Date.now()}`, name: t('bench.defaultName', { n: 1 }), text: '', sourceLang: source, targetLang: target,
    engines: [], freeBefore: true, unloadAfter: true, chunkChars, createdAt: Date.now(),
  }));
  const [runs, setRuns] = useState<EngineRun[]>([]);
  const [running, setRunning] = useState(false);
  const [ranLangs, setRanLangs] = useState<{ src: string; tgt: string; chars: number } | null>(null);
  const [diffA, setDiffA] = useState('');
  const [diffB, setDiffB] = useState('');
  const [importing, setImporting] = useState(false);
  const stopRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { stopRef.current = true; }, []);
  useEffect(() => {
    onRunning(running);
  }, [running, onRunning]);

  const set = (patch: Partial<Scenario>) => setDraft((d) => ({ ...d, ...patch }));

  // ── Engines ──
  const engineOptions: BenchEngine[] = useMemo(() => {
    const list: BenchEngine[] = [{ key: 'auto', label: model.labelOf('auto'), route: 'auto' }];
    if (model.cloudName) list.push({ key: 'cloud', label: model.labelOf('cloud'), route: 'cloud' });
    for (const m of model.installed) list.push({ key: `local:${m.id}`, label: m.label, route: 'local', localModelId: m.id });
    return list;
  }, [model]);

  const addEngine = (key: string) => {
    const e = engineOptions.find((o) => o.key === key);
    if (!e || draft.engines.some((x) => x.key === key) || draft.engines.length >= MAX_ENGINES) return;
    set({ engines: [...draft.engines, e] });
  };
  const moveEngine = (i: number, d: -1 | 1) => {
    const list = [...draft.engines];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    set({ engines: list });
  };

  // ── Text import ──
  const importFile = async () => {
    setImporting(true);
    try {
      const path = await bridge.pickFile([{ name: 'Documents', extensions: ['pdf', 'docx', 'epub', 'txt', 'md'] }]);
      if (path) {
        const doc = await bridge.extractDocument(path);
        set({ text: doc.text, name: draft.name || doc.name });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('docs.addFailed');
      notify(/Unauthorized|dialog:open/i.test(msg) ? t('docs.needsPermission') : msg, 'error');
    }
    setImporting(false);
  };
  const loadTextFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => { if (typeof ev.target?.result === 'string') set({ text: ev.target.result }); };
    reader.onerror = () => notify(t('translate.readFailed'), 'error');
    reader.readAsText(file);
  };

  // ── Scenarios ──
  const save = () => {
    const next = [draft, ...saved.filter((s) => s.id !== draft.id)];
    if (saveScenarios(next)) {
      setSaved(next.slice(0, MAX_SCENARIOS));
      notify(t('bench.saved'), 'success');
    } else notify(t('bench.saveFailed'), 'error');
  };
  const open = (s: Scenario) => {
    setDraft(s);
    setRuns([]);
    setRanLangs(null);
  };
  const remove = (id: string) => {
    const next = saved.filter((s) => s.id !== id);
    saveScenarios(next);
    setSaved(next);
  };
  const fresh = () => open({
    id: `sc-${Date.now()}`, name: t('bench.defaultName', { n: saved.length + 1 }), text: '', sourceLang: source, targetLang: target,
    engines: [], freeBefore: true, unloadAfter: true, chunkChars, createdAt: Date.now(),
  });

  // ── Run ──
  const run = async () => {
    if (running || blocked || draft.engines.length < 1 || !draft.text.trim()) return;
    const src = draft.sourceLang === 'auto' ? (detectLang(draft.text) ?? 'auto') : draft.sourceLang;
    const tgt = draft.targetLang;
    if (src === tgt) {
      notify(t('translate.sameLanguage', { lang: langLabel(tgt) }), 'error');
      return;
    }
    const chunks = splitIntoChunks(draft.text, draft.chunkChars);
    stopRef.current = false;
    setRunning(true);
    setRanLangs({ src, tgt, chars: draft.text.length });
    setRuns(draft.engines.map((e) => emptyRun(e, chunks.length)));
    const ports: BenchPorts = {
      freeIdle: async () => (await bridge.freeIdle()).unloaded,
      load: async (e) => {
        const r = await bridge.warmLocal(e.localModelId ?? '');
        if (!r.loaded) throw new Error(r.error || t('model.loadFailed'));
      },
      translate: (e, chunk, index, total) =>
        bridge.translatePiece(chunk, src, tgt, { route: e.route, localModelId: e.localModelId }, { index, total }),
      // A model still busy (another surface asked it something) is not dropped:
      // said in the row, never pretended.
      unload: async () => { if (!(await bridge.unloadLlm())) throw new Error('NOT_DROPPED'); },
      now: () => performance.now(),
      stopped: () => stopRef.current,
    };
    try {
      const final = await runScenario(draft, chunks, ports, setRuns);
      setRuns(final);
      const ok = final.filter((r) => r.output);
      if (ok.length >= 2) { setDiffA(ok[0]!.key); setDiffB(ok[1]!.key); }
    } catch (err) {
      notify(err instanceof Error ? err.message : t('state.failed'), 'error');
    }
    setRunning(false);
    model.refresh();
  };

  const report = useMemo(() => {
    if (!ranLangs || runs.length === 0 || running) return '';
    return benchReportMarkdown(draft.name, ranLangs.src, ranLangs.tgt, ranLangs.chars, runs, {
      heading: t('bench.reportHeading'), engine: t('bench.col.engine'), status: t('bench.col.status'),
      load: t('bench.col.load'), translate: t('bench.col.translate'), speed: t('bench.col.speed'),
      ratio: t('bench.col.ratio'), agreement: t('bench.agreement'), output: t('bench.outputs'), notMeasured: '—',
      statuses: {
        pending: t('bench.status.pending'), running: t('bench.status.running'), done: t('bench.status.done'),
        error: t('bench.status.error'), stopped: t('bench.status.stopped'),
      },
    }, Date.now());
  }, [ranLangs, runs, running, draft.name]);

  const discuss = async () => {
    try {
      notify(chatSent(await bridge.attachToChat({ name: `bench_${hashString(draft.id)}.md`, text: report, draft: t('chat.draftBench') })), 'success');
    } catch (err) {
      notify(chatError(err), 'error');
    }
  };

  const pairs = useMemo(() => agreementPairs(runs), [runs]);
  const labelOf = (key: string) => runs.find((r) => r.key === key)?.label ?? key;
  const diff = useMemo(() => {
    const a = runs.find((r) => r.key === diffA)?.output;
    const b = runs.find((r) => r.key === diffB)?.output;
    if (!a || !b || diffA === diffB) return undefined;
    return wordDiff(a, b);
  }, [runs, diffA, diffB]);
  const withOutput = runs.filter((r) => r.output);
  const chunksCount = draft.text.trim() ? splitIntoChunks(draft.text, draft.chunkChars).length : 0;

  return (
    <div className="pad" style={{ flex: 1 }}>
      <input ref={fileInput} type="file" accept=".md,.txt" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) loadTextFile(f); e.target.value = ''; }} />
      {saved.length > 0 && (
        <div className="row">
          <span className="lab">{t('bench.saved.list')}</span>
          {saved.map((s) => (
            <span key={s.id} className="row" style={{ gap: 0 }}>
              <button type="button" className={`chip${s.id === draft.id ? ' chosen' : ''}`} onClick={() => open(s)}>{s.name}</button>
              <button type="button" className="icon flat" onClick={() => remove(s.id)} title={t('action.remove')} aria-label={t('action.remove')}><Icon.close /></button>
            </span>
          ))}
          <button type="button" className="flat" onClick={fresh}><Icon.plus /> {t('bench.new')}</button>
        </div>
      )}

      <div className="grid">
        {/* 01 — the text */}
        <div className="hud card">
          <div className="row">
            <span className="lab" style={{ flex: 1 }}>01 · {t('bench.text')}</span>
            <button type="button" className="flat" onClick={() => fileInput.current?.click()}><Icon.file /> .md / .txt</button>
            <button type="button" className="flat" onClick={() => void importFile()} disabled={importing}>
              {importing ? <InfinityLoader size={10} /> : <Icon.file />} PDF · DOCX
            </button>
          </div>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} aria-label={t('bench.name')} placeholder={t('bench.name')} />
          <textarea value={draft.text} onChange={(e) => set({ text: e.target.value })} rows={8} placeholder={t('bench.textPlaceholder')} aria-label={t('bench.text')} />
          <div className="row">
            <select value={draft.sourceLang} onChange={(e) => set({ sourceLang: e.target.value })} aria-label={t('lang.source')}>
              <option value="auto">{t('lang.auto')}</option>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{langLabel(l.code)}</option>)}
            </select>
            <Icon.swap />
            <select value={draft.targetLang} onChange={(e) => set({ targetLang: e.target.value })} aria-label={t('lang.target')}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{langLabel(l.code)}</option>)}
            </select>
            <span className="muted mono" style={{ fontSize: 10.5, marginLeft: 'auto' }}>{t('bench.textSize', { chars: draft.text.length, pieces: chunksCount })}</span>
          </div>
        </div>

        {/* 02 — the engines, in order */}
        <div className="hud card">
          <span className="lab">02 · {t('bench.engines', { n: draft.engines.length, max: MAX_ENGINES })}</span>
          {draft.engines.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('bench.noEngine')}</span>}
          {draft.engines.map((e, i) => (
            <div key={e.key} className="row" style={{ gap: 4 }}>
              <span className="mono holo" style={{ width: 22 }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.label}</span>
              <span className="lab">{e.route === 'local' ? t('model.local') : e.route === 'cloud' ? t('model.cloud') : t('model.auto')}</span>
              <button type="button" className="icon flat" onClick={() => moveEngine(i, -1)} disabled={i === 0} aria-label={t('bench.up')} title={t('bench.up')}><Icon.up /></button>
              <button type="button" className="icon flat" onClick={() => moveEngine(i, 1)} disabled={i === draft.engines.length - 1} aria-label={t('bench.down')} title={t('bench.down')}><Icon.down /></button>
              <button type="button" className="icon flat" onClick={() => set({ engines: draft.engines.filter((x) => x.key !== e.key) })} aria-label={t('action.remove')} title={t('action.remove')}><Icon.close /></button>
            </div>
          ))}
          {draft.engines.length < MAX_ENGINES && (
            <select value="" onChange={(e) => addEngine(e.target.value)} aria-label={t('bench.addEngine')}>
              <option value="">+ {t('bench.addEngine')}</option>
              {engineOptions.filter((o) => !draft.engines.some((x) => x.key === o.key)).map((o) => (
                <option key={o.key} value={o.key}>{o.route === 'local' ? `${t('model.local')} · ${o.label}` : o.label}</option>
              ))}
            </select>
          )}
          <label className="row" style={{ cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={draft.freeBefore} onChange={(e) => set({ freeBefore: e.target.checked })} /> {t('bench.freeBefore')}
          </label>
          <label className="row" style={{ cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={draft.unloadAfter} onChange={(e) => set({ unloadAfter: e.target.checked })} /> {t('bench.unloadAfter')}
          </label>
          <span className="muted" style={{ fontSize: 11 }}>{t('bench.sequentialNote')}</span>
          <div className="row">
            <button type="button" className="flat" onClick={save}><Icon.save /> {t('bench.save')}</button>
            <span style={{ flex: 1 }} />
            {running ? (
              <button type="button" className="danger" onClick={() => { stopRef.current = true; }}><Icon.stop /> {t('action.stop')}</button>
            ) : (
              <button type="button" className="primary" onClick={() => void run()} disabled={blocked || draft.engines.length < 1 || !draft.text.trim()} title={blocked ? t('bench.waitOthers') : undefined}>
                <Icon.play /> {t('bench.run')}
              </button>
            )}
          </div>
        </div>
      </div>

      {runs.length === 0 ? (
        <Empty title={t('bench.emptyTitle')}><span style={{ fontSize: 12 }}>{t('bench.emptyHint')}</span></Empty>
      ) : (
        <>
          {/* 03 — the measures */}
          <div className="hud card" style={{ overflowX: 'auto' }}>
            <div className="row">
              <span className="lab" style={{ flex: 1 }}>03 · {t('bench.measures')}</span>
              {report && (
                <>
                  <button type="button" className="primary" onClick={() => void discuss()}><Icon.chat /> {t('action.discuss')}</button>
                  <button type="button" onClick={() => downloadText(`bench_${draft.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.md`, report)}><Icon.save /> {t('bench.exportReport')}</button>
                  <CopyButton text={report} />
                </>
              )}
            </div>
            <table className="metrics">
              <thead>
                <tr>
                  <th>{t('bench.col.engine')}</th><th>{t('bench.col.status')}</th><th>{t('bench.col.load')}</th>
                  <th>{t('bench.col.translate')}</th><th>{t('bench.col.speed')}</th><th>{t('bench.col.ratio')}</th><th>{t('bench.col.freed')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const cps = charsPerSecond(r);
                  const ratio = ranLangs ? lengthRatio(r, ranLangs.chars) : null;
                  return (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td>
                        <span className={r.status === 'error' ? 'err' : r.status === 'done' ? 'ok' : r.status === 'running' ? 'holo' : 'muted'}>
                          {r.status === 'running' && r.phase ? t(`bench.phase.${r.phase}`) : t(`bench.status.${r.status}`)}
                        </span>
                        {r.status === 'running' && r.phase === 'translate' && (
                          <div style={{ marginTop: 4 }}><Progress done={r.chunksDone} total={r.chunksTotal} /></div>
                        )}
                        {r.error && <div className="err" style={{ fontSize: 11 }}>{r.error}</div>}
                        {r.unloadFailed && <div className="gold" style={{ fontSize: 11 }}>{t('bench.unloadFailed')}</div>}
                      </td>
                      <td className="mono">{secs(r.loadMs)}</td>
                      <td className="mono">{secs(r.translateMs)}</td>
                      <td className="mono">{cps === null ? '—' : Math.round(cps)}</td>
                      <td className="mono">{ratio === null ? '—' : ratio.toFixed(2)}</td>
                      <td className="muted" style={{ fontSize: 11 }}>{r.freed === null ? '—' : r.freed.length ? r.freed.map((id) => t(runtimeKindKey(id))).join(', ') : t('bench.nothingFreed')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {pairs.length > 0 && (
              <div className="row" style={{ marginTop: 6 }}>
                <span className="lab">{t('bench.agreement')}</span>
                {pairs.map((p) => (
                  <span key={`${p.a}|${p.b}`} className="mono" style={{ fontSize: 11.5 }} title={t('bench.agreementHint')}>
                    {labelOf(p.a)} ↔ {labelOf(p.b)}: <span className="holo">{p.score === null ? '—' : `${Math.round(p.score * 100)} %`}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 04 — side by side */}
          {withOutput.length > 0 && (
            <div className="cols">
              {runs.map((r) => (
                <div key={r.key} className="hud card">
                  <div className="row">
                    <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                    {r.status === 'running' && <InfinityLoader size={10} />}
                    {r.output && <CopyButton text={r.output} />}
                  </div>
                  <div className="out">{r.output || <span className="muted">—</span>}</div>
                </div>
              ))}
            </div>
          )}

          {/* 05 — word diff of two columns */}
          {withOutput.length >= 2 && (
            <div className="hud card">
              <div className="row">
                <span className="lab">05 · {t('bench.diff')}</span>
                <select value={diffA} onChange={(e) => setDiffA(e.target.value)} aria-label={t('bench.diffA')}>
                  {withOutput.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                <Icon.swap />
                <select value={diffB} onChange={(e) => setDiffB(e.target.value)} aria-label={t('bench.diffB')}>
                  {withOutput.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                <span className="muted" style={{ fontSize: 11 }}><span className="diff"><span className="del">{t('bench.onlyA')}</span> <span className="add">{t('bench.onlyB')}</span></span></span>
              </div>
              {diff === null ? (
                <span className="muted" style={{ fontSize: 12 }}>{t('bench.diffTooLong')}</span>
              ) : diff ? (
                <div className="diff">
                  {diff.map((p, i) => (
                    <span key={i} className={p.op === 'same' ? undefined : p.op}>{p.text}{' '}</span>
                  ))}
                </div>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>{t('bench.diffPick')}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
