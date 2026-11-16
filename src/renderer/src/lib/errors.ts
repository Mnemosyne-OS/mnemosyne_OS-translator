/** errors.ts — host answers said in words the person can act on. */
import { t } from '../i18n';

/** The line after a hand-over to the chat; a cut document says so. */
export function chatSent(res: { truncated: boolean }): string {
  return res.truncated ? t('chat.sentCut') : t('chat.sent');
}

/** The chat door refuses without a click in the frame, or on a host that predates it. */
export function chatError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/NOT_FROM_A_GESTURE/.test(msg)) return t('chat.needsClick');
  if (/CHAT_UNHEARD/.test(msg)) return t('chat.notOnBoard');
  return hostError(msg, t('chat.failed', { error: msg }));
}

/**
 * A door this host does not have (an app older than Translator 2.0) is said as
 * such, never as a model or network failure.
 */
export function hostError(msg: string, fallback: string): string {
  if (/Unknown action|UNKNOWN_ACTION|not supported|No handler/i.test(msg)) return t('host.tooOld');
  return fallback;
}
