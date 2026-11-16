/**
 * ReviewMode — spaced-repetition flashcards (BETA). One side of a due card,
 * reveal, then grade (Leitner). The direction can be flipped.
 */
import { useState } from 'react';
import { langLabel, t, tc } from '../i18n';
import { MAX_BOX, type VocabEntry } from '../lib/store';
import { Beta } from './Bits';
import { Icon } from './icons';

interface Props {
  queue: VocabEntry[];
  grade: (id: string, remembered: boolean) => void;
  onExit: () => void;
}

export function ReviewMode({ queue, grade, onExit }: Props) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sourceFirst, setSourceFirst] = useState(true);
  const [done, setDone] = useState(0);
  const card: VocabEntry | undefined = queue[index];

  if (!card) {
    return (
      <div className="pad" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <span className="lab ok">{t('review.complete')}</span>
        <span className="muted">{tc('review.done', done)}</span>
        <button type="button" className="primary" onClick={onExit}>{t('review.back')}</button>
      </div>
    );
  }

  const front = sourceFirst ? card.sourceTerm : card.targetTerm;
  const frontLang = sourceFirst ? card.sourceLang : card.targetLang;
  const back = sourceFirst ? card.targetTerm : card.sourceTerm;
  const backLang = sourceFirst ? card.targetLang : card.sourceLang;

  const answer = (remembered: boolean) => {
    grade(card.id, remembered);
    setDone((d) => d + 1);
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="bar" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <button type="button" onClick={onExit}>{t('review.exit')}</button>
        <span className="lab">{t('review.title')}</span>
        <Beta />
        <button type="button" style={{ marginLeft: 'auto' }} onClick={() => setSourceFirst((v) => !v)} title={t('review.flip')}>
          <Icon.swap /> {langLabel(frontLang)} → {langLabel(backLang)}
        </button>
        <span className="mono muted">{Math.min(index + 1, queue.length)} / {queue.length}</span>
      </div>
      <div
        className="pad"
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: revealed ? 'default' : 'pointer' }}
        onClick={() => !revealed && setRevealed(true)}
      >
        <span className="lab">{langLabel(frontLang)}</span>
        <span style={{ fontSize: 28, fontWeight: 500 }}>{front}</span>
        {revealed ? (
          <>
            <span className="lab" style={{ marginTop: 10 }}>{langLabel(backLang)}</span>
            <span style={{ fontSize: 23 }} className="holo">{back}</span>
            {card.pos && <span className="muted" style={{ fontStyle: 'italic' }}>{card.pos}</span>}
            {card.example && (
              <span className="muted" style={{ fontSize: 12.5, maxWidth: 440 }}>
                “{card.example}”{card.exampleTranslation && <><br />“{card.exampleTranslation}”</>}
              </span>
            )}
          </>
        ) : (
          <span className="muted">{t('review.tap')}</span>
        )}
      </div>
      <div className="bar" style={{ justifyContent: 'center', borderTop: '1px solid var(--border-subtle)' }}>
        {revealed ? (
          <>
            <button type="button" className="danger" onClick={() => answer(false)}>{t('review.no')}</button>
            <button type="button" className="primary" onClick={() => answer(true)}>{t('review.yes')}{card.box >= MAX_BOX ? ' ★' : ''}</button>
          </>
        ) : (
          <button type="button" className="primary" onClick={() => setRevealed(true)}>{t('review.reveal')}</button>
        )}
      </div>
    </div>
  );
}
