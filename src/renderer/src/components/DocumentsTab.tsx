/**
 * DocumentsTab — the document pipeline: files are queued, then each is
 * extracted (PDF/DOCX/EPUB, OCR when asked) and translated piece by piece
 * (doc 214 D5), one file after the other. A file used to leave in ONE call
 * capped at 8 192 tokens and came back cut without a word.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { langLabel, t } from '../i18n';
import type { TranslatorBridge } from '../hooks/useBridge';
import type { ModelApi } from '../hooks/useModel';
import type { RememberMeta } from '../hooks/useTranslations';
import { useChunkedTranslate } from '../hooks/useChunkedTranslate';
import { hashString } from '../lib/store';
import { detectLang } from '../lib/langProfile';
import { downloadText } from '../lib/text';
import { chatError, chatSent } from '../lib/errors';
import { CopyButton, Empty, InfinityLoader, Progress } from './Bits';
import { Icon } from './icons';

type JobStatus = 'queued' | 'extracting' | 'translating' | 'done' | 'error' | 'stopped';

interface FileJob {
  id: string;
  path: string;
  name: string;
  status: JobStatus;
  ocrUsed: boolean;
  truncated: boolean;
  error?: string;
  result?: string;
  sourceLang: string;
  targetLang: string;
}

const DOC_FILTERS = [{ name: 'Documents', extensions: ['pdf', 'docx', 'epub', 'txt', 'md'] }];

interface Props {
  bridge: TranslatorBridge;
  model: ModelApi;
  chunkChars: number;
  source: string;
  target: string;
  onTranslated: (sl: string, tl: string, source: string, result: string, meta?: RememberMeta) => void;
  notify: (msg: string, kind: 'error' | 'success') => void;
  /** A Compare pass owns the model memory: translating waits. */
  blocked: boolean;
  /** Reports whether this tab is using the model (the bench waits). */
  onBusy: (busy: boolean) => void;
}

export function DocumentsTab({ bridge, model, chunkChars, source, target, onTranslated, notify, blocked, onBusy }: Props) {
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const [processing, setProcessing] = useState(false);
  const [forceOcr, setForceOcr] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const jobsRef = useRef<FileJob[]>([]);
  const job = useChunkedTranslate(bridge);
  useEffect(() => {
    onBusy(processing);
  }, [processing, onBusy]);

  const commit = useCallback((next: FileJob[]) => {
    jobsRef.current = next;
    setJobs(next);
  }, []);
  const patch = useCallback(
    (id: string, p: Partial<FileJob>) => commit(jobsRef.current.map((j) => (j.id === id ? { ...j, ...p } : j))),
    [commit],
  );

  const addFile = async () => {
    try {
      const path = await bridge.pickFile(DOC_FILTERS);
      if (!path) return;
      const name = path.split(/[\\/]/).pop() || 'document';
      const id = hashString(`${path}|${source}|${target}`);
      if (jobsRef.current.some((j) => j.id === id)) {
        notify(t('docs.alreadyQueued'), 'error');
        return;
      }
      commit([...jobsRef.current, { id, path, name, status: 'queued', ocrUsed: false, truncated: false, sourceLang: source, targetLang: target }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('docs.addFailed');
      notify(/Unauthorized|dialog:open/i.test(msg) ? t('docs.needsPermission') : msg, 'error');
    }
  };

  const processJob = async (j: FileJob): Promise<boolean> => {
    setCurrentId(j.id);
    try {
      patch(j.id, { status: 'extracting', error: undefined });
      const doc = await bridge.extractDocument(j.path, forceOcr);
      if (!doc.text.trim()) throw new Error(t('docs.noText'));
      patch(j.id, { status: 'translating', ocrUsed: doc.ocrUsed, truncated: doc.truncated });
      const src = j.sourceLang === 'auto' ? (detectLang(doc.text) ?? 'auto') : j.sourceLang;
      const res = await job.run(doc.text, src, j.targetLang, model.engine, chunkChars, (soFar) => patch(j.id, { result: soFar }));
      if (res.stopped) {
        patch(j.id, { status: 'stopped', result: res.text });
        return false;
      }
      patch(j.id, { status: 'done', result: res.text });
      onTranslated(src, j.targetLang, doc.text, res.text, { fileName: doc.name || j.name, ocrUsed: doc.ocrUsed });
      return true;
    } catch (err) {
      patch(j.id, { status: 'error', error: err instanceof Error ? err.message : t('state.failed') });
      return true;
    } finally {
      setCurrentId(null);
    }
  };

  const runAll = async () => {
    if (processing || blocked) return;
    setProcessing(true);
    // Sequential: the host serializes inference anyway, and OCR is heavy.
    for (const j of jobsRef.current) {
      if (j.status !== 'queued' && j.status !== 'error' && j.status !== 'stopped') continue;
      const cur = jobsRef.current.find((x) => x.id === j.id);
      if (cur && !(await processJob(cur))) break;
    }
    setProcessing(false);
  };

  const discuss = async (j: FileJob) => {
    if (!j.result) return;
    try {
      notify(chatSent(await bridge.attachToChat({
        name: `${j.name.replace(/\.[^.]+$/, '')}_${j.targetLang}.md`,
        text: j.result,
        draft: t('chat.draftDocument', { name: j.name }),
      })), 'success');
    } catch (err) {
      notify(chatError(err), 'error');
    }
  };

  const pending = jobs.some((j) => j.status === 'queued' || j.status === 'error' || j.status === 'stopped');
  const statusLabel = (s: JobStatus) => t(`docs.status.${s}`);

  return (
    <div className="pad" style={{ flex: 1 }}>
      <div className="hud bar">
        <span className="lab">{langLabel(source)} → {langLabel(target)}</span>
        <label className="row" style={{ gap: 4, cursor: 'pointer', fontSize: 11 }} title={t('docs.ocrTitle')}>
          <input type="checkbox" checked={forceOcr} onChange={(e) => setForceOcr(e.target.checked)} /> OCR
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => void addFile()}><Icon.plus /> {t('docs.add')}</button>
        {processing ? (
          <button type="button" className="danger" onClick={job.stop}><Icon.stop /> {t('action.stop')}</button>
        ) : (
          <button type="button" className="primary" onClick={() => void runAll()} disabled={!pending || blocked} title={blocked ? t('bench.blocking') : undefined}><Icon.play /> {t('docs.runAll')}</button>
        )}
      </div>

      {jobs.length === 0 ? (
        <Empty title={t('docs.emptyTitle')}>
          <span style={{ fontSize: 12 }}>PDF · DOCX · EPUB · TXT · MD</span>
          <button type="button" onClick={() => void addFile()}><Icon.plus /> {t('docs.add')}</button>
        </Empty>
      ) : (
        <div className="grid">
          {jobs.map((j) => {
            const busy = j.status === 'extracting' || j.status === 'translating';
            return (
              <div key={j.id} className={`hud card${j.status === 'done' ? ' chosen' : ''}`}>
                <div className="row">
                  <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={j.name}>{j.name}</span>
                  <span className={`lab ${j.status === 'error' ? 'err' : j.status === 'done' ? 'ok' : ''}`}>
                    {statusLabel(j.status)}{j.ocrUsed ? ' · OCR' : ''}
                  </span>
                  {busy && <InfinityLoader size={10} />}
                </div>
                <span className="muted" style={{ fontSize: 11 }}>{langLabel(j.sourceLang)} → {langLabel(j.targetLang)}</span>
                {currentId === j.id && job.progress && <Progress done={job.progress.done} total={job.progress.total} />}
                {j.truncated && <span className="gold" style={{ fontSize: 11 }}>{t('docs.truncated')}</span>}
                {j.error && <span className="err" style={{ fontSize: 11 }}>{j.error}</span>}
                {j.result && <span className="muted" style={{ fontSize: 12 }}>{j.result.slice(0, 180)}{j.result.length > 180 ? '…' : ''}</span>}
                <div className="row">
                  {j.result && (
                    <>
                      <CopyButton text={j.result} />
                      <button type="button" className="flat" onClick={() => downloadText(`${j.name.replace(/\.[^.]+$/, '')}_${j.targetLang}.md`, j.result ?? '')}><Icon.save /> {t('action.export')}</button>
                      <button type="button" className="flat" onClick={() => void discuss(j)}><Icon.chat /> {t('action.discuss')}</button>
                    </>
                  )}
                  {!processing && !blocked && (j.status === 'queued' || j.status === 'error' || j.status === 'stopped') && (
                    <button type="button" className="flat" onClick={() => { setProcessing(true); void processJob(j).finally(() => setProcessing(false)); }}>
                      <Icon.play /> {j.status === 'queued' ? t('translate.go') : t('action.retry')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon flat"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => commit(jobsRef.current.filter((x) => x.id !== j.id))}
                    disabled={busy}
                    title={t('action.remove')}
                    aria-label={t('action.remove')}
                  >
                    <Icon.close />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <span className="muted" style={{ fontSize: 11, textAlign: 'right' }}>{model.label}</span>
    </div>
  );
}
