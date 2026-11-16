/**
 * TranslateTab — type or drop a text, Ctrl+Enter, read the translation.
 *
 * The target follows "my languages" (doc 214 §9): with an auto source the text
 * is detected locally and the target set from the profile, unless the person
 * chose a target by hand for this text. A long text goes piece by piece (D5)
 * with a progress line and a Stop.
 */
import { useEffect, useRef, useState } from 'react';
import { langLabel, t, tc } from '../i18n';
import type { TranslatorBridge } from '../hooks/useBridge';
import type { ModelApi } from '../hooks/useModel';
import type { RememberMeta } from '../hooks/useTranslations';
import { useChunkedTranslate } from '../hooks/useChunkedTranslate';
import { detectLang } from '../lib/langProfile';
import { buildExtractionPrompt, parseVocabJSON, toEntries } from '../lib/vocab';
import type { VocabEntry } from '../lib/store';
import { Beta, CopyButton, InfinityLoader, Progress, WorkingPane } from './Bits';
import { Icon } from './icons';
import { counts, downloadText } from '../lib/text';
import { chatError, chatSent } from '../lib/errors';

export interface TranslatePreload {
  source: string;
  result: string;
  sourceLang: string;
  targetLang: string;
  fileName?: string;
  ocrUsed?: boolean;
}

interface Props {
  bridge: TranslatorBridge;
  model: ModelApi;
  chunkChars: number;
  source: string;
  target: string;
  /** Reports the detected language (auto source) so the top bar shows it and the target follows. */
  onDetected: (code: string | null) => void;
  onTranslated: (sl: string, tl: string, source: string, result: string, meta?: RememberMeta) => void;
  onVocabExtracted: (entries: VocabEntry[]) => number;
  notify: (msg: string, kind: 'error' | 'success') => void;
  preload: TranslatePreload | null;
  onPreloadConsumed: () => void;
  /** Reports whether the source pane is empty (the App unpins a hand-picked target then). */
  onEmpty: (empty: boolean) => void;
  /** A Compare pass owns the model memory: translating waits. */
  blocked: boolean;
  /** Reports whether this tab is using the model (the bench waits). */
  onBusy: (busy: boolean) => void;
}

export function TranslateTab(props: Props) {
  const { bridge, model, source, target, notify } = props;
  const [text, setText] = useState('');
  const [out, setOut] = useState('');
  const [meta, setMeta] = useState<RememberMeta>({});
  const [detected, setDetected] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  // The pair the translation on screen was made in. The chips may move after
  // (verifier pass 214, finding 4): export, chat and vocabulary read THIS pair.
  const [outPair, setOutPair] = useState<{ src: string; tgt: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const job = useChunkedTranslate(bridge);
  const { onDetected, onEmpty, preload, onPreloadConsumed, onBusy } = props;

  useEffect(() => {
    onBusy(job.busy || extracting);
  }, [job.busy, extracting, onBusy]);

  useEffect(() => {
    if (!preload) return;
    setText(preload.source);
    setOut(preload.result);
    setOutPair({ src: preload.sourceLang, tgt: preload.targetLang });
    setMeta({ fileName: preload.fileName, ocrUsed: preload.ocrUsed });
    onPreloadConsumed();
  }, [preload, onPreloadConsumed]);

  // Local detection, debounced: only meaningful with an auto source.
  useEffect(() => {
    if (source !== 'auto') {
      setDetected(null);
      onDetected(null);
      return;
    }
    const timer = setTimeout(() => {
      const code = detectLang(text);
      setDetected(code);
      onDetected(code);
    }, 300);
    return () => clearTimeout(timer);
  }, [text, source, onDetected]);

  useEffect(() => onEmpty(!text.trim()), [text, onEmpty]);

  const edit = (v: string) => {
    setText(v);
    if (meta.fileName || meta.ocrUsed) setMeta({});
  };

  const promptSource = source === 'auto' ? (detected ?? 'auto') : source;

  const translate = async () => {
    if (!text.trim() || job.busy || props.blocked) return;
    if (promptSource === target) {
      notify(t('translate.sameLanguage', { lang: langLabel(target) }), 'error');
      return;
    }
    setOut('');
    setOutPair({ src: promptSource, tgt: target });
    try {
      const res = await job.run(text, promptSource, target, model.engine, props.chunkChars, setOut);
      setOut(res.text);
      if (res.stopped) notify(t('translate.stopped'), 'error');
      else if (res.text.trim()) props.onTranslated(promptSource, target, text, res.text, meta);
    } catch (err) {
      notify(err instanceof Error ? err.message : t('translate.failed'), 'error');
    }
  };

  const loadFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'md' && ext !== 'txt') {
      notify(t('translate.onlyText'), 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') {
        setText(ev.target.result);
        setMeta({ fileName: file.name });
      }
    };
    reader.onerror = () => {
      console.error('[Translator] file read failed:', reader.error);
      notify(t('translate.readFailed'), 'error');
    };
    reader.readAsText(file);
  };

  const pair = outPair ?? { src: promptSource, tgt: target };

  const discuss = async () => {
    const name = `${meta.fileName?.replace(/\.[^.]+$/, '') ?? t('chat.translationName')}_${pair.src}-${pair.tgt}.md`;
    const body = `# ${langLabel(pair.src)} → ${langLabel(pair.tgt)}\n\n## ${t('report.original')}\n\n${text}\n\n## ${t('report.translatedText')}\n\n${out}\n`;
    try {
      notify(chatSent(await bridge.attachToChat({ name, text: body, draft: t('chat.draftTranslation') })), 'success');
    } catch (err) {
      notify(chatError(err), 'error');
    }
  };

  const extract = async () => {
    if (!text.trim() || !out.trim() || extracting || props.blocked) return;
    setExtracting(true);
    try {
      const { systemPrompt, prompt } = buildExtractionPrompt(text, out, pair.src, pair.tgt);
      const raw = await bridge.infer({ systemPrompt, prompt, temperature: 0.1, maxTokens: 2048, engine: model.engine });
      const entries = toEntries(parseVocabJSON(raw), pair.src, pair.tgt, Date.now());
      if (entries.length === 0) notify(t('vocab.noneFound'), 'error');
      else {
        const added = props.onVocabExtracted(entries);
        notify(added > 0 ? tc('vocab.added', added) : t('vocab.already'), 'success');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : t('vocab.failed'), 'error');
    }
    setExtracting(false);
  };

  return (
    <div className="pad" style={{ flex: 1, minHeight: 0 }}>
      <input ref={fileInput} type="file" accept=".md,.txt" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
      <div className="panes">
        <div
          className="hud pane"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}
        >
          <textarea
            value={text}
            onChange={(e) => edit(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void translate(); } }}
            placeholder={t('translate.placeholder')}
            aria-label={t('translate.sourceLabel')}
          />
          <div className="foot">
            <button type="button" className="flat" onClick={() => fileInput.current?.click()} title={t('translate.openFile')}><Icon.file /> .md / .txt</button>
            {text && <button type="button" className="flat" onClick={() => { edit(''); setOut(''); }}>{t('action.clear')}</button>}
            {meta.fileName && <span className="muted" style={{ fontSize: 11 }}>{meta.fileName}</span>}
            <span className="muted mono" style={{ marginLeft: 'auto', fontSize: 10 }}>{counts(text)}</span>
          </div>
        </div>
        <div className={`hud pane${job.busy ? ' working' : ''}`}>
          <div className="out" aria-live="polite">
            {out || (job.busy
              ? <WorkingPane pair={`${langLabel(pair.src)} → ${langLabel(pair.tgt)}`} engine={model.label} />
              : <span className="muted">{t('translate.resultPlaceholder')}</span>)}
          </div>
          <div className="foot">
            {out && (
              <>
                <CopyButton text={out} />
                <button type="button" className="flat" onClick={() => downloadText(`translation_${pair.tgt}.md`, out)}><Icon.save /> {t('action.export')}</button>
                <button type="button" className="flat" onClick={() => void discuss()}><Icon.chat /> {t('action.discuss')}</button>
                <button type="button" className="flat" onClick={() => void extract()} disabled={extracting || job.busy || props.blocked}>
                  {extracting ? <InfinityLoader size={10} /> : <Icon.book />} {t('vocab.extract')} <Beta />
                </button>
              </>
            )}
            <span className="muted mono" style={{ marginLeft: 'auto', fontSize: 10 }}>{counts(out)}</span>
          </div>
        </div>
      </div>
      <div className="row">
        <div className="grow">
          {job.progress && job.progress.total > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="lab">{t('progress.pieces', { done: job.progress.done, total: job.progress.total })}</span>
              <Progress done={job.progress.done} total={job.progress.total} />
            </div>
          )}
        </div>
        <span className="muted" style={{ fontSize: 11 }}>{model.label}</span>
        {job.busy ? (
          <button type="button" className="danger" onClick={job.stop}><Icon.stop /> {t('action.stop')}</button>
        ) : (
          <button type="button" className="primary" onClick={() => void translate()} disabled={!text.trim() || props.blocked} title={props.blocked ? t('bench.blocking') : 'Ctrl+Enter'}>
            <Icon.play /> {t('translate.go')}
          </button>
        )}
      </div>
    </div>
  );
}
