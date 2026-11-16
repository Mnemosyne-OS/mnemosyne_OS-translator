/**
 * RepertoireTab — the learned-word glossary (BETA): searchable, filterable by
 * language pair, and the door to the spaced-repetition review over the cards
 * due now (or all of them when none is due yet).
 */
import { useMemo, useState } from 'react';
import { langLabel, t, tc } from '../i18n';
import { dueEntries, MAX_BOX, type VocabEntry } from '../lib/store';
import { Beta, Empty } from './Bits';
import { Icon } from './icons';
import { ReviewMode } from './ReviewMode';

interface Props {
  vocab: VocabEntry[];
  grade: (id: string, remembered: boolean) => void;
  remove: (id: string) => void;
}

export function RepertoireTab({ vocab, grade, remove }: Props) {
  const [search, setSearch] = useState('');
  const [pair, setPair] = useState('all');
  const [reviewQueue, setReviewQueue] = useState<VocabEntry[] | null>(null);

  const pairs = useMemo(() => {
    const set = new Map<string, string>();
    for (const e of vocab) {
      const key = `${e.sourceLang}>${e.targetLang}`;
      if (!set.has(key)) set.set(key, `${langLabel(e.sourceLang)} → ${langLabel(e.targetLang)}`);
    }
    return Array.from(set.entries());
  }, [vocab]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vocab
      .filter((e) => pair === 'all' || `${e.sourceLang}>${e.targetLang}` === pair)
      .filter((e) => !q || e.sourceTerm.toLowerCase().includes(q) || e.targetTerm.toLowerCase().includes(q) || (e.note?.toLowerCase().includes(q) ?? false))
      .sort((a, b) => b.at - a.at);
  }, [vocab, search, pair]);

  const dueCount = useMemo(() => dueEntries(vocab, Date.now()).length, [vocab]);

  const startReview = () => {
    const scope = filtered.length > 0 ? filtered : vocab;
    const due = dueEntries(scope, Date.now());
    setReviewQueue(due.length > 0 ? due : [...scope].sort((a, b) => a.due - b.due));
  };

  if (reviewQueue) return <ReviewMode queue={reviewQueue} grade={grade} onExit={() => setReviewQueue(null)} />;

  if (vocab.length === 0) {
    return (
      <div className="pad" style={{ flex: 1 }}>
        <Empty title={t('vocab.emptyTitle')}>
          <span style={{ fontSize: 12 }}>{t('vocab.emptyHint')}</span>
          <Beta />
        </Empty>
      </div>
    );
  }

  return (
    <div className="pad" style={{ flex: 1 }}>
      <div className="row">
        <input className="grow" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('vocab.search')} aria-label={t('vocab.search')} />
        {pairs.length > 1 && (
          <select value={pair} onChange={(e) => setPair(e.target.value)} aria-label={t('vocab.pairs')}>
            <option value="all">{t('vocab.allPairs')}</option>
            {pairs.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        )}
        <button type="button" className="primary" onClick={startReview}>
          {t('vocab.review')}{dueCount > 0 ? ` (${dueCount})` : ''} <Beta />
        </button>
      </div>
      <span className="lab">
        {tc('vocab.count', vocab.length, { shown: filtered.length })} · {dueCount > 0 ? tc('vocab.due', dueCount) : t('vocab.allReviewed')}
      </span>
      <div className="grid">
        {filtered.map((e) => (
          <div key={e.id} className="hud card">
            <div className="row">
              <span style={{ fontSize: 15, fontWeight: 500 }}>{e.sourceTerm}</span>
              <span className="muted">→</span>
              <span style={{ fontSize: 15 }} className="holo">{e.targetTerm}</span>
              {e.pos && <span className="muted" style={{ fontSize: 11, fontStyle: 'italic' }}>{e.pos}</span>}
              <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 10, letterSpacing: 1 }} title={t('vocab.boxTitle', { box: e.box, max: MAX_BOX, reviews: e.reviews, lapses: e.lapses })}>
                {'●'.repeat(e.box)}{'○'.repeat(Math.max(0, MAX_BOX - e.box))}
              </span>
              <button type="button" className="icon flat" onClick={() => remove(e.id)} title={t('action.remove')} aria-label={t('action.remove')}><Icon.close /></button>
            </div>
            {e.example && (
              <span className="muted" style={{ fontSize: 12 }}>
                “{e.example}”{e.exampleTranslation && <> — “{e.exampleTranslation}”</>}
              </span>
            )}
            {e.note && <span className="muted" style={{ fontSize: 11, fontStyle: 'italic' }}>{e.note}</span>}
            <span className="lab">{langLabel(e.sourceLang)} → {langLabel(e.targetLang)}</span>
          </div>
        ))}
      </div>
      {filtered.length === 0 && <Empty title={t('vocab.noMatch')} />}
    </div>
  );
}
