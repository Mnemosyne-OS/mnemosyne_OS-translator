/**
 * usePrefs — the Translator's settings, kept in localStorage and mirrored to
 * the host's durable state (doc 73) so the far view reads the same languages
 * and engine (doc 214 D10).
 *
 * At connect, a durable copy wins over a localStorage that has nothing of its
 * own (the frame's origin changed, or site data was cleared): the person's
 * languages must not reset because the app moved port.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranslatorBridge } from './useBridge';
import { LEGACY_ENGINE_KEY, normalizePrefs, PREFS_KEY, type TranslatorPrefs } from '../lib/prefs';
import { uiLang } from '../i18n';

function readLocal(): { prefs: TranslatorPrefs; found: boolean } {
  let raw: unknown = null;
  let legacy: string | null = null;
  try {
    const s = localStorage.getItem(PREFS_KEY);
    raw = s ? JSON.parse(s) : null;
    legacy = localStorage.getItem(LEGACY_ENGINE_KEY);
  } catch (err) {
    console.warn('[Translator] stored settings unreadable, defaults used:', err);
  }
  return { prefs: normalizePrefs(raw, uiLang(), legacy), found: raw !== null };
}

export interface PrefsApi {
  prefs: TranslatorPrefs;
  update: (patch: Partial<TranslatorPrefs>) => void;
}

export function usePrefs(bridge: TranslatorBridge): PrefsApi {
  const initial = useRef(readLocal());
  const [prefs, setPrefs] = useState<TranslatorPrefs>(initial.current.prefs);
  // True once the durable copy can no longer be overwritten by mistake: this
  // origin had its own settings, or the durable copy was read (and adopted).
  const [settled, setSettled] = useState(initial.current.found);

  // Adopt the durable copy once, when this origin had none of its own. Settled
  // when the answer is APPLIED, not when the read starts: StrictMode runs this
  // effect twice in development and cancels the first read.
  useEffect(() => {
    if (!bridge.connected || settled) return;
    let cancelled = false;
    bridge.stateGet()
      .then((state) => {
        if (cancelled) return;
        if (state && typeof state.prefs === 'object') setPrefs(normalizePrefs(state.prefs, uiLang()));
        setSettled(true);
      })
      .catch((err) => {
        console.warn('[Translator] durable settings unreadable:', err);
        // Unreadable is not "absent": never overwrite a copy we could not read.
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, settled]);

  // Persist on every change: localStorage now, the durable mirror shortly after.
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (err) {
      console.warn('[Translator] settings not saved locally:', err);
    }
    // The defaults of a fresh origin must not overwrite the durable copy before it was read.
    if (!bridge.connected || !settled) return;
    const timer = setTimeout(() => {
      bridge.stateSet({ prefs }).catch((err) => console.warn('[Translator] durable settings not saved:', err));
    }, 400);
    return () => clearTimeout(timer);
  }, [prefs, bridge, settled]);

  const update = useCallback((patch: Partial<TranslatorPrefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  return { prefs, update };
}
