/**
 * Cartridge-local i18n (same pattern as mnemo-budget and mnemo-crm).
 *
 * The interface follows the HOST's language: `?lang=` in the frame URL at
 * load, then every MNEMO_CONFIG_UPDATE broadcast (App.tsx calls
 * `setHostLanguage`). Browser language, then English, when the host says
 * nothing usable. A missing key falls back to English, then to the key itself.
 */
import { useEffect, useState } from 'react';
import en from './locales/en.json';
import fr from './locales/fr.json';
import es from './locales/es.json';

export type UiLang = 'en' | 'fr' | 'es';

const DICTIONARY: Record<UiLang, Record<string, string>> = {
  en: en as Record<string, string>,
  fr: fr as Record<string, string>,
  es: es as Record<string, string>,
};

function isUiLang(v: string | null | undefined): v is UiLang {
  return !!v && v in DICTIONARY;
}

function fromUrl(): UiLang | null {
  try {
    const code = (new URLSearchParams(window.location.search).get('lang') ?? '').slice(0, 2);
    return isUiLang(code) ? code : null;
  } catch (err) {
    console.warn('[Translator] host language unreadable from the URL:', err);
    return null;
  }
}

function fromBrowser(): UiLang {
  const code = (typeof navigator !== 'undefined' ? navigator.language : '').slice(0, 2);
  return isUiLang(code) ? code : 'en';
}

let hostLang: UiLang | null = typeof window !== 'undefined' ? fromUrl() : null;
const listeners = new Set<() => void>();

/** The interface language now. */
export function uiLang(): UiLang {
  return hostLang ?? fromBrowser();
}

/** Called with every host config broadcast. */
export function setHostLanguage(lang: unknown): void {
  const code = typeof lang === 'string' ? lang.slice(0, 2) : '';
  if (isUiLang(code) && code !== hostLang) {
    hostLang = code;
    listeners.forEach((fn) => fn());
  }
}

/** Translates `key`, replacing `{{name}}` with `vars.name`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = uiLang();
  let text = DICTIONARY[lang][key] ?? DICTIONARY.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{{${k}}}`).join(String(v));
  return text;
}

/** One / many without a plural library: `key.one` and `key.many`. */
export function tc(key: string, count: number, vars?: Record<string, string | number>): string {
  return t(`${key}.${count === 1 ? 'one' : 'many'}`, { count, ...vars });
}

/** Re-renders the caller when the host language changes. */
export function useI18n(): { t: typeof t; tc: typeof tc; lang: UiLang } {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return { t, tc, lang: uiLang() };
}

/** A language's name in the interface language (Intl), its code when unknown. */
export function langLabel(code: string): string {
  if (code === 'auto') return t('lang.auto');
  try {
    const name = new Intl.DisplayNames([uiLang()], { type: 'language' }).of(code);
    if (name && name !== code) return name.charAt(0).toUpperCase() + name.slice(1);
  } catch (err) {
    console.warn('[Translator] Intl.DisplayNames unavailable:', err);
  }
  return code.toUpperCase();
}
