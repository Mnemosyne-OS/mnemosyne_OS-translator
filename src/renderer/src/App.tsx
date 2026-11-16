/**
 * Translator 2.0 — shell (doc 214).
 *
 * One bar always on screen (source, "my languages", engine, free memory,
 * settings) and six tabs in the order of use: Translate, Documents, Web page,
 * Compare, Vocabulary, History.
 *
 * The engine is chosen per call (`forceMode` + `localModelId`) and never
 * changes the chat's model (D1). A local pick goes through the chat's own
 * loading ritual, drawn by the host (D4).
 *
 * Local stores (history + vocab) are the source of truth, best-effort mirrored
 * into this app's sandbox vault (doc 58): translations → SOCIAL_NODE,
 * vocabulary → REFERENCE.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslatorBridge } from './hooks/useBridge';
import { useTranslations, type RememberMeta } from './hooks/useTranslations';
import { useVocab } from './hooks/useVocab';
import { useModel } from './hooks/useModel';
import { usePrefs } from './hooks/usePrefs';
import { setHostLanguage, t, useI18n } from './i18n';
import { pickTarget } from './lib/langProfile';
import { hostError } from './lib/errors';
import { blockedFor, type BusyMap, type TabId } from './lib/busy';
import { freedSummary, gbText } from './lib/runtimeNames';
import { langName, type TranslationRecord, type VocabEntry } from './lib/store';
import { TopBar } from './components/TopBar';
import { SettingsPanel } from './components/SettingsPanel';
import { TranslateTab, type TranslatePreload } from './components/TranslateTab';
import { DocumentsTab } from './components/DocumentsTab';
import { WebTab } from './components/WebTab';
import { CompareTab } from './components/CompareTab';
import { RepertoireTab } from './components/RepertoireTab';
import { HistoryTab } from './components/HistoryTab';

type Tab = 'translate' | 'documents' | 'web' | 'compare' | 'vocab' | 'history';
const TABS: Tab[] = ['translate', 'documents', 'web', 'compare', 'vocab', 'history'];
const TAB_KEY = 'translator_tab_v2';

const TRANSLATION_SPINE = 'SOCIAL_NODE';
const VOCAB_SPINE = 'REFERENCE';

function loadTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.includes(v as Tab) ? (v as Tab) : 'translate';
  } catch (err) {
    console.warn('[Translator] last tab unreadable:', err);
    return 'translate';
  }
}

export default function App() {
  useI18n();
  const bridge = useTranslatorBridge();
  const { prefs, update } = usePrefs(bridge);
  const setEngine = useCallback((engine: string, engineLabel: string) => update({ engine, engineLabel }), [update]);
  const model = useModel(bridge, { choice: prefs.engine, setChoice: setEngine, freeBeforeLoad: prefs.freeBeforeLoad });
  const { history, remember, remove: removeTranslation, clear: clearHistory } = useTranslations();
  const { vocab, addMany, grade, remove } = useVocab();

  const [tab, setTabState] = useState<Tab>(loadTab);
  const [source, setSource] = useState('auto');
  const [target, setTarget] = useState(() => prefs.profile.mine[0] ?? 'en');
  const [pinned, setPinned] = useState(false);
  const [textEmpty, setTextEmpty] = useState(true);
  const [detected, setDetected] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [freeing, setFreeing] = useState(false);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; msg: string } | null>(null);
  const [sandboxVault, setSandboxVault] = useState('');
  const [preload, setPreload] = useState<TranslatePreload | null>(null);
  // Who is using the model now: a Compare pass waits for the other tabs and
  // the other tabs wait for it (lib/busy), or the pass measures their loads.
  const [busy, setBusy] = useState<BusyMap>({});
  const busyFor = useMemo(() => {
    const one = (id: TabId) => (b: boolean) => setBusy((m) => (m[id] === b ? m : { ...m, [id]: b }));
    return { translate: one('translate'), documents: one('documents'), web: one('web'), compare: one('compare') };
  }, []);

  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]));
  const setTab = (next: Tab) => {
    setTabState(next);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch (err) {
      console.warn('[Translator] last tab not saved:', err);
    }
  };

  const notify = useCallback((msg: string, kind: 'error' | 'success') => setStatus({ msg, kind }), []);
  // A failed load is said once in the status line; the pill keeps the red dot
  // and the reason in its tooltip. A banner that never leaves stops being read.
  useEffect(() => {
    if (model.error) notify(t('model.errorLine', { error: model.error }), 'error');
  }, [model.error, notify]);
  useEffect(() => {
    if (model.notice) notify(model.notice, 'success');
  }, [model.notice, notify]);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), status.kind === 'error' ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [status]);

  // The host's language AND look, live (MNEMO_CONFIG_UPDATE): data-theme on
  // <html>, and every host design token set inline on <html>, which beats the
  // fallbacks of theme.css. The frame URL carries the ground too, so a light
  // host shows no dark flash before its first broadcast.
  useEffect(() => {
    const root = document.documentElement;
    const initial = new URLSearchParams(window.location.search).get('theme');
    if (initial === 'dark' || initial === 'light') root.setAttribute('data-theme', initial);
    const handler = (e: MessageEvent) => {
      if (e.source !== window.parent || e.data?.type !== 'MNEMO_CONFIG_UPDATE') return;
      const d = e.data as { lang?: unknown; theme?: unknown; tokens?: unknown };
      setHostLanguage(d.lang);
      if (d.theme === 'dark' || d.theme === 'light') root.setAttribute('data-theme', d.theme);
      if (d.tokens && typeof d.tokens === 'object') {
        for (const [key, value] of Object.entries(d.tokens as Record<string, unknown>)) {
          if (key.startsWith('--') && typeof value === 'string') root.style.setProperty(key, value);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // A hand-picked target holds for the text it was picked for; an empty
  // source pane lets "my languages" choose again.
  const onEmpty = useCallback((empty: boolean) => {
    // Only a text that was there and is gone unpins: the tab mounting empty
    // must not drop a language picked before typing.
    setTextEmpty((was) => {
      if (empty && !was) setPinned(false);
      return empty;
    });
  }, []);

  // A language picked by hand holds, picked before typing or after; clearing
  // the text gives the choice back to « my languages » (onEmpty).
  const onLangs = (s: string, tg: string) => {
    setSource(s);
    setTarget(tg);
    setPinned(true);
  };

  // The target follows what the text is (doc 214 §9), unless picked by hand —
  // and never stays equal to the detected source.
  useEffect(() => {
    if (source !== 'auto' || !detected) return;
    if (pinned && detected !== target) return;
    const next = pickTarget(prefs.profile, detected, target);
    if (next !== target) setTarget(next);
  }, [detected, source, pinned, target, prefs.profile]);

  const freeMemory = async () => {
    setFreeing(true);
    try {
      // What is resident BEFORE, for the weights: the host names engines by id
      // and only the list carries `approxBytes` (null when unknown, never 0).
      const before = await bridge.runtimeList().catch((err) => {
        console.warn('[Translator] resident engines unreadable, freed weight unknown:', err);
        return null;
      });
      const gone = await model.freeMemory();
      if (gone.length === 0) {
        notify(t('model.nothingToFree'), 'success');
      } else {
        const s = freedSummary(gone, before);
        const list = s.keys.map((k) => t(k)).join(', ');
        notify(s.bytes === null
          ? t('model.freedList', { list })
          : t(s.partial ? 'model.freedListAtLeast' : 'model.freedListGb', { list, gb: gbText(s.bytes) }), 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(hostError(msg, t('model.freeFailed', { error: msg })), 'error');
    }
    setFreeing(false);
  };

  // Ensure the walled-off sandbox vault, then declare its Vault Pad tile.
  useEffect(() => {
    if (!bridge.connected) return;
    let cancelled = false;
    (async () => {
      try {
        const sb = await bridge.ensureSandbox();
        if (cancelled || !sb?.vault) return;
        setSandboxVault(sb.vault);
        await bridge.describeVaultTile({
          icon: '🌐',
          metrics: [
            { label: t('tile.translations'), spine: TRANSLATION_SPINE },
            { label: t('tile.words'), spine: VOCAB_SPINE },
          ],
        });
      } catch (err) {
        console.warn('[Translator] sandbox vault ensure failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  // Mirror remembered translations into the sandbox — idempotent per vault.
  useEffect(() => {
    if (!sandboxVault.startsWith('APP-') || history.length === 0) return;
    let cancelled = false;
    (async () => {
      const key = `translator_synced_v1:${sandboxVault}`;
      let synced: Record<string, true> = {};
      try {
        synced = JSON.parse(localStorage.getItem(key) || '{}');
      } catch (err) {
        console.warn('[Translator] sync ledger unreadable, starting over:', err);
        synced = {};
      }
      let pushed = 0;
      for (const r of history) {
        if (synced[r.id]) continue;
        const date = new Date(r.at).toISOString().slice(0, 10);
        const content =
          `Translation (${langName(r.sourceLang)} → ${langName(r.targetLang)}), ${date}${r.fileName ? `, from ${r.fileName}` : ''}. ` +
          `Source: "${r.source.slice(0, 1000)}". Result: "${r.result.slice(0, 6000)}".`;
        try {
          await bridge.socialIngest(sandboxVault, content, TRANSLATION_SPINE);
          if (cancelled) return;
          synced[r.id] = true;
          pushed++;
        } catch (err) {
          console.warn('[Translator] translation sync failed', err);
        }
      }
      if (pushed > 0 && !cancelled) {
        try {
          localStorage.setItem(key, JSON.stringify(synced));
        } catch (err) {
          console.warn('[Translator] sync ledger not saved:', err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxVault, history]);

  // Mirror learned words into the sandbox as REFERENCE chronicles — idempotent.
  useEffect(() => {
    if (!sandboxVault.startsWith('APP-') || vocab.length === 0) return;
    let cancelled = false;
    (async () => {
      const key = `translator_vocab_synced_v1:${sandboxVault}`;
      let synced: Record<string, true> = {};
      try {
        synced = JSON.parse(localStorage.getItem(key) || '{}');
      } catch (err) {
        console.warn('[Translator] vocab ledger unreadable, starting over:', err);
        synced = {};
      }
      let pushed = 0;
      for (const v of vocab) {
        if (synced[v.id]) continue;
        const parts = [
          `Vocabulary (${langName(v.sourceLang)} → ${langName(v.targetLang)}): "${v.sourceTerm}" = "${v.targetTerm}"`,
          v.pos ? `(${v.pos})` : '',
          v.example ? `Example: "${v.example}".` : '',
          v.note ? `Note: ${v.note}` : '',
        ];
        try {
          await bridge.socialIngest(sandboxVault, parts.filter(Boolean).join(' '), VOCAB_SPINE);
          if (cancelled) return;
          synced[v.id] = true;
          pushed++;
        } catch (err) {
          console.warn('[Translator] vocab sync failed', err);
        }
      }
      if (pushed > 0 && !cancelled) {
        try {
          localStorage.setItem(key, JSON.stringify(synced));
        } catch (err) {
          console.warn('[Translator] vocab ledger not saved:', err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxVault, vocab]);

  const onTranslated = useCallback(
    (sl: string, tl: string, src: string, result: string, meta?: RememberMeta) => remember(sl, tl, src, result, meta),
    [remember],
  );
  const onVocabExtracted = useCallback((entries: VocabEntry[]): number => addMany(entries), [addMany]);
  const openRecord = (r: TranslationRecord) => {
    setSource(r.sourceLang);
    setTarget(r.targetLang);
    setPreload({ source: r.source, result: r.result, sourceLang: r.sourceLang, targetLang: r.targetLang, fileName: r.fileName, ocrUsed: r.ocrUsed });
    setTab('translate');
  };
  const consumePreload = useCallback(() => setPreload(null), []);
  const dueCount = useMemo(() => vocab.filter((v) => v.due <= Date.now()).length, [vocab]);

  const common = { bridge, model, chunkChars: prefs.chunkChars, source, target, notify };
  const blocked = blockedFor('translate', busy);

  return (
    <div className="hud-root">
      <TopBar
        profile={prefs.profile}
        source={source}
        target={target}
        detected={detected}
        onLangs={onLangs}
        model={model}
        onFree={() => void freeMemory()}
        freeing={freeing}
        blocked={blocked}
        onSettings={() => setSettingsOpen(true)}
        connected={bridge.connected}
      />
      <nav className="tabs" role="tablist">
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {t(`tab.${id}`)}
            {id === 'vocab' && dueCount > 0 && <span className="count"> {dueCount}</span>}
          </button>
        ))}
      </nav>
      {status && (
        <div className={`status ${status.kind === 'success' ? 'ok' : 'err'}`} role="status">{status.msg}</div>
      )}
      {busy.compare && tab !== 'compare' && <div className="status" role="status">{t('bench.blocking')}</div>}
      {tab === 'compare' && blockedFor('compare', busy) && <div className="status" role="status">{t('bench.waitOthers')}</div>}
      <main className="main">
        {/* A tab once opened stays mounted, hidden: switching away must not
            drop the text being typed, a document queue, or a bench mid-run. */}
        <TabPane id="translate" active={tab} visited={visited}>
          <TranslateTab
            {...common}
            onDetected={setDetected}
            onTranslated={onTranslated}
            onVocabExtracted={onVocabExtracted}
            preload={preload}
            onPreloadConsumed={consumePreload}
            onEmpty={onEmpty}
            blocked={blocked}
            onBusy={busyFor.translate}
          />
        </TabPane>
        <TabPane id="documents" active={tab} visited={visited}><DocumentsTab {...common} onTranslated={onTranslated} blocked={blocked} onBusy={busyFor.documents} /></TabPane>
        <TabPane id="web" active={tab} visited={visited}><WebTab {...common} sandboxVault={sandboxVault} onTranslated={onTranslated} blocked={blocked} onBusy={busyFor.web} /></TabPane>
        <TabPane id="compare" active={tab} visited={visited}><CompareTab {...common} onRunning={busyFor.compare} blocked={blockedFor('compare', busy)} /></TabPane>
        <TabPane id="vocab" active={tab} visited={visited}><RepertoireTab vocab={vocab} grade={grade} remove={remove} /></TabPane>
        <TabPane id="history" active={tab} visited={visited}>
          <HistoryTab history={history} onOpen={openRecord} remove={removeTranslation} clear={clearHistory} />
        </TabPane>
      </main>
      {settingsOpen && <SettingsPanel prefs={prefs} update={update} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/** One tab's content: mounted from its first visit, hidden when not active. */
function TabPane({ id, active, visited, children }: { id: Tab; active: Tab; visited: Set<Tab>; children: ReactNode }) {
  if (!visited.has(id)) return null;
  return (
    <div role="tabpanel" hidden={id !== active} style={{ display: id === active ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {children}
    </div>
  );
}
