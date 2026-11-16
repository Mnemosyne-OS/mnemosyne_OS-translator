/**
 * WebTab — translate a web page into a report (doc 214 §7).
 *
 * The page is read ON THIS MACHINE by the host (`web.readPage`, https only,
 * decision C8: the address goes to nobody else), cut into pieces, translated,
 * and laid out as a Markdown report with three exits: discuss it in the chat
 * (a document attachment, D9), keep it in the Translator's own vault (D8),
 * export it as a file.
 */
import { useEffect, useMemo, useState } from 'react';
import { langLabel, t } from '../i18n';
import type { TranslatorBridge, WebPage } from '../hooks/useBridge';
import type { ModelApi } from '../hooks/useModel';
import type { RememberMeta } from '../hooks/useTranslations';
import { useChunkedTranslate } from '../hooks/useChunkedTranslate';
import { detectLang } from '../lib/langProfile';
import { splitIntoChunks } from '../lib/chunk';
import { webReportMarkdown } from '../lib/report';
import { downloadText } from '../lib/text';
import { chatError, chatSent, hostError } from '../lib/errors';
import { CopyButton, Empty, InfinityLoader, Progress } from './Bits';
import { Icon } from './icons';

/** The Translator's own vault cap per chronicle (the host refuses beyond). */
const KEEP_MAX_CHARS = 50_000;

interface Props {
  bridge: TranslatorBridge;
  model: ModelApi;
  chunkChars: number;
  source: string;
  target: string;
  sandboxVault: string;
  onTranslated: (sl: string, tl: string, source: string, result: string, meta?: RememberMeta) => void;
  notify: (msg: string, kind: 'error' | 'success') => void;
  /** A Compare pass owns the model memory: translating waits. */
  blocked: boolean;
  /** Reports whether this tab is using the model (the bench waits). */
  onBusy: (busy: boolean) => void;
}

interface Done {
  page: WebPage;
  sourceLang: string;
  /** The target it was translated INTO: the chips may move after, the report must not. */
  targetLang: string;
  translated: string;
  chunks: number;
  at: number;
  engineLabel: string;
}

/** Says what went wrong reading a page, in words (the host gives codes). */
function readError(msg: string): string {
  if (/HTTPS_ONLY|https only|not https/i.test(msg)) return t('web.err.https');
  if (/NOT_TEXT|not a text page/i.test(msg)) return t('web.err.notText');
  if (/EMPTY/i.test(msg)) return t('web.err.empty');
  if (/HTTP \d+/.test(msg)) return t('web.err.http', { code: msg.match(/HTTP (\d+)/)?.[1] ?? '' });
  return hostError(msg, t('web.err.generic', { error: msg }));
}

export function WebTab({ bridge, model, chunkChars, source, target, sandboxVault, onTranslated, notify, blocked, onBusy }: Props) {
  const [url, setUrl] = useState('');
  const [reading, setReading] = useState(false);
  const [page, setPage] = useState<WebPage | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [partial, setPartial] = useState('');
  const [keeping, setKeeping] = useState(false);
  const job = useChunkedTranslate(bridge);
  useEffect(() => {
    onBusy(job.busy);
  }, [job.busy, onBusy]);

  const normalizedUrl = (raw: string) => {
    const v = raw.trim();
    if (!v) return '';
    return /^[a-z]+:\/\//i.test(v) ? v : `https://${v}`;
  };

  const read = async () => {
    const u = normalizedUrl(url);
    if (!u || reading) return;
    setReading(true);
    setPage(null);
    setDone(null);
    setPartial('');
    try {
      const p = await bridge.readPage(u);
      if (!p.text.trim()) throw new Error('EMPTY');
      setPage(p);
    } catch (err) {
      notify(readError(err instanceof Error ? err.message : String(err)), 'error');
    }
    setReading(false);
  };

  const translate = async () => {
    if (!page || job.busy || blocked) return;
    const src = source === 'auto' ? (detectLang(page.text) ?? 'auto') : source;
    if (src === target) {
      notify(t('translate.sameLanguage', { lang: langLabel(target) }), 'error');
      return;
    }
    setDone(null);
    setPartial('');
    try {
      const res = await job.run(page.text, src, target, model.engine, chunkChars, setPartial);
      if (res.stopped) {
        notify(t('translate.stopped'), 'error');
        return;
      }
      setDone({ page, sourceLang: src, targetLang: target, translated: res.text, chunks: res.chunks, at: Date.now(), engineLabel: model.label });
      onTranslated(src, target, page.text, res.text, { fileName: page.title ?? page.url });
    } catch (err) {
      notify(err instanceof Error ? err.message : t('translate.failed'), 'error');
    }
  };

  const report = useMemo(() => {
    if (!done) return '';
    return webReportMarkdown(
      {
        url: done.page.url, title: done.page.title, published: done.page.published,
        sourceLang: done.sourceLang, targetLang: done.targetLang, engineLabel: done.engineLabel,
        readAt: done.at, chunks: done.chunks, translated: done.translated, original: done.page.text,
        truncated: done.page.truncated,
      },
      {
        heading: t('report.webHeading', { src: langLabel(done.sourceLang), tgt: langLabel(done.targetLang) }),
        address: t('report.address'), readOn: t('report.readOn'), published: t('report.published'),
        engine: t('report.engine'), pieces: t('report.pieces'), truncated: t('report.truncated'),
        translatedText: t('report.translatedText'), original: t('report.original'),
      },
    );
  }, [done]);

  const fileName = () => {
    const base = (done?.page.title || done?.page.url || 'page').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);
    return `${base || 'page'}_${done?.targetLang ?? target}.md`;
  };

  const discuss = async () => {
    try {
      notify(chatSent(await bridge.attachToChat({ name: fileName(), text: report, draft: t('chat.draftWeb') })), 'success');
    } catch (err) {
      notify(chatError(err), 'error');
    }
  };

  const keep = async () => {
    if (!sandboxVault || keeping) return;
    setKeeping(true);
    try {
      await bridge.socialIngest(sandboxVault, report.slice(0, KEEP_MAX_CHARS), 'SOCIAL_NODE');
      notify(report.length > KEEP_MAX_CHARS
        ? t('web.keptCut', { vault: sandboxVault, max: KEEP_MAX_CHARS.toLocaleString() })
        : t('web.kept', { vault: sandboxVault }), 'success');
    } catch (err) {
      notify(t('web.keepFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    }
    setKeeping(false);
  };

  const pieces = page ? splitIntoChunks(page.text, chunkChars).length : 0;

  return (
    <div className="pad" style={{ flex: 1 }}>
      {/* noValidate: Chromium refuses « lemonde.fr » in a type=url field before
          onSubmit, so normalizedUrl (which adds https://) never ran. */}
      <form className="hud bar" noValidate onSubmit={(e) => { e.preventDefault(); void read(); }}>
        <Icon.globe />
        <input
          className="grow"
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          aria-label={t('web.address')}
          style={{ flex: 1, minWidth: 160 }}
        />
        <button type="submit" disabled={!url.trim() || reading}>
          {reading ? <InfinityLoader size={10} /> : <Icon.down />} {t('web.read')}
        </button>
      </form>

      {!page && !reading && (
        <Empty title={t('web.emptyTitle')}>
          <span style={{ fontSize: 12 }}>{t('web.emptyHint')}</span>
        </Empty>
      )}

      {page && (
        <div className="hud card">
          <div className="row">
            <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{page.title || page.url}</span>
            <span className="lab">{t('web.size', { chars: page.text.length, pieces })}</span>
          </div>
          <span className="muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>{page.url}{page.published ? ` · ${page.published}` : ''}</span>
          {page.truncated && <span className="gold" style={{ fontSize: 11 }}>{t('report.truncated')}</span>}
          <div className="row">
            <span className="lab">{langLabel(source === 'auto' ? (detectLang(page.text) ?? 'auto') : source)} → {langLabel(target)}</span>
            <span style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: 11 }}>{model.label}</span>
            {job.busy ? (
              <button type="button" className="danger" onClick={job.stop}><Icon.stop /> {t('action.stop')}</button>
            ) : (
              <button type="button" className="primary" onClick={() => void translate()} disabled={blocked} title={blocked ? t('bench.blocking') : undefined}><Icon.play /> {t('web.translate')}</button>
            )}
          </div>
          {job.progress && (
            <>
              <span className="lab">{t('progress.pieces', { done: job.progress.done, total: job.progress.total })}</span>
              <Progress done={job.progress.done} total={job.progress.total} />
            </>
          )}
        </div>
      )}

      {(partial || done) && (
        <div className="hud card" style={{ flex: 1 }}>
          <div className="row">
            <span className="lab" style={{ flex: 1 }}>{done ? t('web.report') : t('state.working')}</span>
            {done && (
              <>
                <button type="button" className="primary" onClick={() => void discuss()}><Icon.chat /> {t('action.discuss')}</button>
                <button type="button" onClick={() => void keep()} disabled={!sandboxVault || keeping} title={sandboxVault ? t('web.keepTitle', { vault: sandboxVault }) : t('web.noVault')}>
                  {keeping ? <InfinityLoader size={10} /> : <Icon.memory />} {t('web.keep')}
                </button>
                <button type="button" onClick={() => downloadText(fileName(), report)}><Icon.save /> {t('action.export')}</button>
                <CopyButton text={report} />
              </>
            )}
          </div>
          <div className="report">{done ? report : partial}</div>
        </div>
      )}
    </div>
  );
}
