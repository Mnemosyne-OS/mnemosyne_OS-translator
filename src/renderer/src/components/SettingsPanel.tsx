/**
 * SettingsPanel — "my languages" and the few switches the Translator keeps
 * (doc 214 §4). A drawer on the right; a click on the backdrop closes it.
 */
import { langLabel, t } from '../i18n';
import { promoteMine, setPair, toggleMine } from '../lib/langProfile';
import { LANGUAGES } from '../lib/store';
import { clampChunkChars, MAX_CHUNK_CHARS, MIN_CHUNK_CHARS } from '../lib/chunk';
import type { TranslatorPrefs } from '../lib/prefs';
import { Icon } from './icons';

interface Props {
  prefs: TranslatorPrefs;
  update: (patch: Partial<TranslatorPrefs>) => void;
  onClose: () => void;
}

export function SettingsPanel({ prefs, update, onClose }: Props) {
  const { profile } = prefs;
  return (
    <div className="drawer-back" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('settings.title')}>
        <div className="row">
          <span className="lab" style={{ flex: 1 }}>{t('settings.title')}</span>
          <button type="button" className="icon flat" onClick={onClose} aria-label={t('action.close')} title={t('action.close')}><Icon.close /></button>
        </div>

        <section className="hud card">
          <span className="lab">01 · {t('settings.mine')}</span>
          <div className="chips">
            {profile.mine.map((code, i) => (
              <span key={code} className="row" style={{ gap: 2 }}>
                <button type="button" className="chip chosen" onClick={() => update({ profile: toggleMine(profile, code) })} title={t('settings.remove', { lang: langLabel(code) })}>
                  {i + 1}. {langLabel(code)}
                </button>
                {i > 0 && (
                  <button type="button" className="icon flat" onClick={() => update({ profile: promoteMine(profile, code) })} title={t('settings.promote')} aria-label={t('settings.promote')}>
                    <Icon.up />
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="chips">
            {LANGUAGES.filter((l) => !profile.mine.includes(l.code)).map((l) => (
              <button key={l.code} type="button" className="chip" onClick={() => update({ profile: toggleMine(profile, l.code) })} title={t('settings.add')}>
                + {langLabel(l.code)}
              </button>
            ))}
          </div>
        </section>

        <section className="hud card">
          <span className="lab">02 · {t('settings.pair')}</span>
          <div className="row">
            <select value={profile.pair[0]} onChange={(e) => update({ profile: setPair(profile, e.target.value, profile.pair[1]) })} aria-label={t('settings.pairA')}>
              {profile.mine.map((c) => <option key={c} value={c}>{langLabel(c)}</option>)}
            </select>
            <Icon.swap />
            <select value={profile.pair[1]} onChange={(e) => update({ profile: setPair(profile, profile.pair[0], e.target.value) })} aria-label={t('settings.pairB')}>
              {profile.mine.map((c) => <option key={c} value={c}>{langLabel(c)}</option>)}
            </select>
          </div>
          <span className="muted" style={{ fontSize: 11 }}>{t('settings.pairHint', { a: langLabel(profile.pair[0]), b: langLabel(profile.pair[1]) })}</span>
        </section>

        <section className="hud card">
          <span className="lab">03 · {t('settings.engine')}</span>
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={prefs.freeBeforeLoad} onChange={(e) => update({ freeBeforeLoad: e.target.checked })} />
            {t('settings.freeBeforeLoad')}
          </label>
          <label className="row">
            <span className="grow">{t('settings.chunk')}</span>
            <input
              type="number"
              min={MIN_CHUNK_CHARS}
              max={MAX_CHUNK_CHARS}
              step={500}
              value={prefs.chunkChars}
              onChange={(e) => update({ chunkChars: clampChunkChars(Number(e.target.value)) })}
              style={{ width: 96 }}
            />
          </label>
        </section>
      </div>
    </div>
  );
}
