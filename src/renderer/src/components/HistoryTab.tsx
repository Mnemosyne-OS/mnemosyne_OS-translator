/**
 * HistoryTab — every translation kept (typed text, files, web pages), with the
 * figures on top and a search. « Open » puts one back in the Translate tab.
 */
import { useMemo, useState } from 'react';
import { langLabel, t, tc } from '../i18n';
import type { TranslationRecord } from '../lib/store';
import { computeStats, fmtNum } from '../lib/stats';
import { downloadText } from '../lib/text';
import { CopyButton, Empty } from './Bits';
import { Icon } from './icons';

interface Props {
  history: TranslationRecord[];
  onOpen: (r: TranslationRecord) => void;
  remove: (id: string) => void;
  clear: () => void;
}

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    console.warn('[Translator] date formatting unavailable:', err);
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function HistoryTab({ history, onOpen, remove, clear }: Props) {
  const [search, setSearch] = useState('');
  const [onlyFiles, setOnlyFiles] = useState(false);
  const stats = useMemo(() => computeStats(history), [history]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history
      .filter((r) => !onlyFiles || !!r.fileName)
      .filter((r) => !q || r.source.toLowerCase().includes(q) || r.result.toLowerCase().includes(q) || (r.fileName?.toLowerCase().includes(q) ?? false));
  }, [history, search, onlyFiles]);

  const exportOne = (r: TranslationRecord) => {
    const body = `# ${langLabel(r.sourceLang)} → ${langLabel(r.targetLang)}\n\n## ${t('report.original')}\n\n${r.source}\n\n## ${t('report.translatedText')}\n\n${r.result}\n`;
    downloadText(`${r.fileName ? r.fileName.replace(/\.[^.]+$/, '') : 'translation'}_${r.targetLang}.md`, body);
  };

  const tiles = [
    { label: t('history.stat.translations'), value: fmtNum(stats.total) },
    { label: t('history.stat.documents'), value: fmtNum(stats.files), hint: stats.ocr > 0 ? t('history.stat.ocr', { n: stats.ocr }) : undefined },
    { label: t('history.stat.words'), value: fmtNum(stats.words) },
    { label: t('history.stat.languages'), value: fmtNum(stats.languages) },
  ];

  return (
    <div className="pad" style={{ flex: 1 }}>
      <div className="stats">
        {tiles.map((x) => (
          <div key={x.label} className="hud card stat">
            <span className="v">{x.value}</span>
            <span className="lab">{x.label}</span>
            {x.hint && <span className="muted" style={{ fontSize: 10 }}>{x.hint}</span>}
          </div>
        ))}
      </div>

      <div className="row">
        <input className="grow" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('history.search')} aria-label={t('history.search')} />
        <label className="row" style={{ gap: 4, fontSize: 11, cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyFiles} onChange={(e) => setOnlyFiles(e.target.checked)} /> {t('history.onlyFiles')}
        </label>
        {history.length > 0 && (
          <button type="button" className="danger flat" onClick={() => { if (window.confirm(t('history.clearConfirm'))) clear(); }}>
            <Icon.trash /> {t('history.clear')}
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <Empty title={t('history.emptyTitle')} />
      ) : (
        <>
          <span className="lab">{tc('history.count', history.length, { shown: filtered.length })}</span>
          <div className="grid">
            {filtered.map((r) => (
              <div key={r.id} className="hud card">
                <div className="row">
                  <span className="lab holo">{r.sourceLang.toUpperCase()} → {r.targetLang.toUpperCase()}</span>
                  <span className="muted" style={{ fontSize: 11, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.fileName}>
                    {r.fileName ? `${r.fileName}${r.ocrUsed ? ' · OCR' : ''}` : t('history.typed')}
                  </span>
                  <span className="muted mono" style={{ fontSize: 10 }}>{fmtDate(r.at)}</span>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>{r.source.slice(0, 140)}{r.source.length > 140 ? '…' : ''}</span>
                <span style={{ fontSize: 12.5 }}>{r.result.slice(0, 160)}{r.result.length > 160 ? '…' : ''}</span>
                <div className="row">
                  <button type="button" className="flat" onClick={() => onOpen(r)}>{t('history.open')}</button>
                  <CopyButton text={r.result} />
                  <button type="button" className="flat" onClick={() => exportOne(r)}><Icon.save /> {t('action.export')}</button>
                  <button type="button" className="icon flat" style={{ marginLeft: 'auto' }} onClick={() => remove(r.id)} title={t('action.remove')} aria-label={t('action.remove')}><Icon.close /></button>
                </div>
              </div>
            ))}
          </div>
          {filtered.length === 0 && <Empty title={t('history.noMatch')} />}
        </>
      )}
    </div>
  );
}
