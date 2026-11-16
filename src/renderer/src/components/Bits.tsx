/**
 * Bits — the small components every screen uses: the copy button with its
 * feedback, the beta tag, the ∞ loader, the progress line, the empty state.
 * Components only (Fast Refresh): icons live in icons.tsx, text helpers in
 * lib/text.ts.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { Icon } from './icons';


type CopyState = 'idle' | 'copied' | 'error';

/** Copies `text`; the label says ✓ or the failure for 1.4 s. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (s: CopyState) => {
    setState(s);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1400);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      flash('copied');
    } catch (err) {
      console.warn('[Translator] clipboard refused:', err);
      flash('error');
    }
  };
  return (
    <button type="button" className={state === 'copied' ? 'flat chosen' : 'flat'} onClick={() => void copy()} title={t('action.copy')} disabled={!text}>
      <Icon.copy />
      {state === 'copied' ? t('action.copied') : state === 'error' ? t('action.copyFailed') : (label ?? t('action.copy'))}
    </button>
  );
}

/** A small amber BETA tag for the learning features. */
export function Beta() {
  return <span className="lab gold" title={t('beta.title')} style={{ fontSize: 8.5, letterSpacing: '0.14em' }}>{t('beta.tag')}</span>;
}

const LEMNISCATE = 'M20,20 C20,8 36,8 40,20 C44,32 60,32 60,20 C60,8 44,8 40,20 C36,32 20,32 20,20';

/** ∞ with a lit segment travelling its path: work in progress. */
export function InfinityLoader({ size = 14 }: { size?: number }) {
  return (
    <svg width={(size * 80) / 40} height={size} viewBox="0 0 80 40" fill="none" role="img" aria-label={t('state.working')} style={{ display: 'block', overflow: 'visible' }}>
      <path d={LEMNISCATE} stroke="var(--border-subtle)" strokeWidth={6} strokeLinecap="round" />
      <path className="mnemo-infinity-run" d={LEMNISCATE} pathLength={100} stroke="var(--accent-violet)" strokeWidth={6} strokeLinecap="round" strokeDasharray="22 78" />
    </svg>
  );
}

/** mm:ss of a whole number of seconds. */
function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * What the result pane shows while a translation runs and nothing came back
 * yet: the loop, the pair, the seconds spent and the engine. The clock is the
 * honest part: a local model may first be loading, and the wait is shown as it is.
 */
export function WorkingPane({ pair, engine }: { pair: string; engine: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="working-pane" role="status">
      <InfinityLoader size={26} />
      <span className="lab holo">{t('translate.working')}</span>
      <span className="mono working-clock">{pair} · {clock(seconds)}</span>
      <span className="muted" style={{ fontSize: 11 }}>{engine}</span>
    </div>
  );
}

/** A thin line filled to done/total; green once complete. */
export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className={`progress${pct >= 100 ? ' done' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

/** An empty state: a label and what to do. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="lab">{title}</div>
      {children}
    </div>
  );
}
