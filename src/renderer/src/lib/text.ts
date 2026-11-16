/** text.ts — saving a text as a file, and the counts the panes show. */
import { t } from '../i18n';

/** Saves `text` as a file through the frame (a plain download, no host door). */
export function downloadText(name: string, text: string, type = 'text/markdown'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Words and characters of a text, as the panes show them. */
export function counts(text: string): string {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return t('counts', { chars: text.length, words });
}
