/**
 * busy.ts — who waits for whom while the model memory is in use.
 *
 * A Compare pass frees, loads and unloads models one after the other: a
 * translation started elsewhere meanwhile would make the pass measure ITS
 * loads. And the reverse holds too (verifier pass 214, finding 2): a pass
 * started while a document is being translated would swap the model under
 * that document's next piece. So the bench waits for every other tab, and
 * every other tab waits for the bench.
 */

export type TabId = 'translate' | 'documents' | 'web' | 'compare' | 'vocab' | 'history';

/** Tabs that run translations on the model. */
export type BusyMap = Partial<Record<TabId, boolean>>;

/** Whether `tab` must wait: the bench waits for any other busy tab, the others wait for the bench. */
export function blockedFor(tab: TabId, busy: BusyMap): boolean {
  if (tab === 'compare') {
    return (Object.keys(busy) as TabId[]).some((k) => k !== 'compare' && busy[k] === true);
  }
  return busy.compare === true;
}
