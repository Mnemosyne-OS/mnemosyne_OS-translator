/**
 * TopBar — always on screen (doc 214 §4): the source, "my languages" as
 * chips (the target is the green one), the swap, the engine pill, freeing
 * the memory, and the settings.
 *
 * A chip click sets the target; a click on the target chip swaps the pair
 * (lib/langProfile `chipTarget`), the en⇄es reflex in one click.
 */
import { useEffect, useRef, useState } from 'react';
import { langLabel, t } from '../i18n';
import { chipTarget, type LangProfile } from '../lib/langProfile';
import { LANGUAGES } from '../lib/store';
import type { ModelApi } from '../hooks/useModel';
import { InfinityLoader } from './Bits';
import { Icon } from './icons';

interface Props {
  profile: LangProfile;
  source: string;
  target: string;
  /** Detected language of the current text when the source is auto. */
  detected: string | null;
  onLangs: (source: string, target: string) => void;
  model: ModelApi;
  onFree: () => void;
  freeing: boolean;
  onSettings: () => void;
  connected: boolean;
  /** A Compare pass is running: no model change, no freeing, until it ends. */
  blocked: boolean;
}

export function TopBar({ profile, source, target, detected, onLangs, model, onFree, freeing, onSettings, connected, blocked }: Props) {
  const outside = profile.mine.includes(target) ? null : target;
  // An auto source with a detected language swaps like a chosen one: the
  // en⇄es reflex in one click from the default state (doc 214 §4).
  const effective = source === 'auto' ? detected : source;
  return (
    <div className="topbar">
      <select
        value={source}
        onChange={(e) => onLangs(e.target.value, target)}
        aria-label={t('lang.source')}
        title={t('lang.source')}
        style={{ maxWidth: 170 }}
      >
        <option value="auto">{detected ? t('lang.autoDetected', { lang: langLabel(detected) }) : t('lang.auto')}</option>
        {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{langLabel(l.code)}</option>)}
      </select>
      <button
        type="button"
        className="icon flat"
        onClick={() => effective && onLangs(target, effective)}
        disabled={!effective}
        title={t('lang.swap')}
        aria-label={t('lang.swap')}
      >
        <Icon.swap />
      </button>
      <span className="lab">{t('lang.into')}</span>
      <div className="chips" role="group" aria-label={t('lang.mine')}>
        {profile.mine.map((code) => {
          // The target chip, or the chip of the detected source, swaps the pair;
          // any other chip only sets the target and keeps « auto ».
          const swaps = code === target || code === effective;
          const next = chipTarget(swaps && effective ? effective : source, target, code);
          return (
            <button
              key={code}
              type="button"
              className={`chip${code === target ? ' chosen' : ''}`}
              onClick={() => onLangs(next.source, next.target)}
              title={langLabel(code)}
              aria-pressed={code === target}
            >
              {code.toUpperCase()}
            </button>
          );
        })}
        {outside && <button type="button" className="chip chosen" title={langLabel(outside)} aria-pressed>{outside.toUpperCase()}</button>}
        <select
          value=""
          onChange={(e) => e.target.value && onLangs(source, e.target.value)}
          aria-label={t('lang.other')}
          title={t('lang.other')}
          style={{ width: 70 }}
        >
          <option value="">{t('lang.otherShort')}</option>
          {LANGUAGES.filter((l) => !profile.mine.includes(l.code)).map((l) => (
            <option key={l.code} value={l.code}>{langLabel(l.code)}</option>
          ))}
        </select>
      </div>
      <div className="spacer" />
      <ModelPill model={model} blocked={blocked} />
      <button type="button" className="icon flat" onClick={onFree} disabled={freeing || !connected || blocked} title={blocked ? t('bench.blocking') : t('model.freeTitle')} aria-label={t('model.free')}>
        {freeing ? <InfinityLoader size={10} /> : <Icon.free />}
      </button>
      <button type="button" className="icon flat" onClick={onSettings} title={t('settings.title')} aria-label={t('settings.title')}>
        <Icon.gear />
      </button>
      <span className={`dot ${connected ? 'ready' : 'error'}`} title={connected ? t('bridge.ok') : t('bridge.off')} />
    </div>
  );
}

/** The engine pill and its list. A local model goes through the chat's ritual (useModel.choose). */
function ModelPill({ model, blocked }: { model: ModelApi; blocked: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (c: string) => {
    setOpen(false);
    void model.choose(c);
  };
  const dot = model.status === 'ready' ? 'ready' : model.status === 'loading' ? 'loading' : model.status === 'error' ? 'error' : '';

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <button
        type="button"
        className="flat"
        onClick={() => { if (!open) model.refresh(); setOpen((o) => !o); }}
        disabled={blocked}
        title={blocked ? t('bench.blocking') : (model.error ?? t('model.pickTitle'))}
        aria-expanded={open}
        style={{ maxWidth: 240 }}
      >
        <span className={`dot ${dot}`} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {model.status === 'loading' ? t('model.loading') : model.label}
        </span>
      </button>
      {open && (
        <div className="pop" role="menu">
          <button type="button" role="menuitem" className={model.choice === 'auto' ? 'chosen' : ''} onClick={() => pick('auto')}>
            {t('model.auto')} <span className="muted" style={{ fontSize: 10.5 }}>{t('model.autoHint')}</span>
          </button>
          {model.cloudName && (
            <button type="button" role="menuitem" className={model.choice === 'cloud' ? 'chosen' : ''} onClick={() => pick('cloud')}>
              {t('model.cloud')} · {model.cloudName}
            </button>
          )}
          <div className="lab" style={{ padding: '6px 8px 2px' }}>{t('model.localModels')}</div>
          {model.installed.length === 0 && <div className="muted" style={{ padding: '4px 8px', fontSize: 11 }}>{t('model.noLocal')}</div>}
          {model.installed.map((m) => {
            const c = `local:${m.id}`;
            return (
              <button key={m.id} type="button" role="menuitem" className={model.choice === c ? 'chosen' : ''} onClick={() => pick(c)}>
                <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</span>
                {m.sizeBytes > 0 && <span className="mono muted" style={{ fontSize: 10 }}>{(m.sizeBytes / 1024 ** 3).toFixed(1)} GB</span>}
              </button>
            );
          })}
          <div className="muted" style={{ padding: '6px 8px', fontSize: 10.5, lineHeight: 1.45, whiteSpace: 'normal' }}>
            {t('model.replacesChat')}
          </div>
        </div>
      )}
    </div>
  );
}
