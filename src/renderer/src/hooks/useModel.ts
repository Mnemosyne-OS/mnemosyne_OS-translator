/**
 * useModel — which engine translates, and loading it the way the chat does.
 *
 * A choice is 'auto' | 'cloud' | 'local:<id>' (lib/prefs). Picking a local
 * model opens the HOST's loading ritual (`model.loadRitual`, the chat's own
 * LocalLoadModal: memory check, what holds the memory and what to unload,
 * « load anyway »). It never changes the chat's model (doc 214 D1); the llama
 * worker holds one model, so loading this one replaces the chat's in memory
 * (D2) and the screen says so.
 *
 * `ready` means: this cartridge loaded it, and a local language model is still
 * resident. The host lists the resident model by file name, not by id, so a
 * swap made by the chat in between is not seen; the next translation then
 * loads ours again on its own (the route loads what it is asked for).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineSpec, LocalModelInfo, ModelConfig, TranslatorBridge } from './useBridge';
import { engineSpecOf, type EngineChoice } from '../lib/prefs';
import { t } from '../i18n';
import { loadErrorKey, ritualOutcome, type ModelStatus } from '../lib/ritual';

export type { ModelStatus };

export interface ModelApi {
  choice: EngineChoice;
  engine: EngineSpec;
  /** On-screen name of the chosen engine. */
  label: string;
  installed: LocalModelInfo[];
  config: ModelConfig | null;
  /** The configured cloud model's name, null when no cloud provider is set. */
  cloudName: string | null;
  status: ModelStatus;
  error: string | null;
  /** Said once on success (a load that skipped the memory check); null otherwise. */
  notice: string | null;
  /** Picks an engine; a local one goes through the ritual first. */
  choose: (choice: EngineChoice) => Promise<void>;
  /** Unloads every idle engine; returns their ids. */
  freeMemory: () => Promise<string[]>;
  refresh: () => void;
  labelOf: (choice: EngineChoice) => string;
}

interface Options {
  choice: EngineChoice;
  setChoice: (choice: EngineChoice, label: string) => void;
  freeBeforeLoad: boolean;
}

export function useModel(bridge: TranslatorBridge, opts: Options): ModelApi {
  const { choice, setChoice, freeBeforeLoad } = opts;
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [installed, setInstalled] = useState<LocalModelInfo[]>([]);
  const [status, setStatus] = useState<ModelStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    if (!bridge.connected) return;
    bridge.getModelConfig().then(setConfig).catch((err) => {
      console.warn('[Translator] model config unreadable:', err);
      setConfig(null);
    });
    bridge.getInstalledModels().then(setInstalled).catch((err) => {
      console.warn('[Translator] installed models unreadable:', err);
      setInstalled([]);
    });
    // A model we loaded that is no longer resident is not ready any more.
    bridge.runtimeList()
      .then((list) => {
        if (!list.some((r) => r.kind === 'llm')) setStatus((s) => (s === 'ready' ? 'idle' : s));
      })
      .catch((err) => console.warn('[Translator] resident engines unreadable:', err));
  }, [bridge]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const cloudName = config?.cloud?.provider ? (config.cloud.model || config.cloud.provider) : null;

  const labelOf = useCallback((c: EngineChoice): string => {
    const spec = engineSpecOf(c);
    if (spec.route === 'cloud') return cloudName ? `${t('model.cloud')} · ${cloudName}` : t('model.cloud');
    if (spec.route === 'local') {
      const id = spec.localModelId ?? config?.local?.activeModel;
      const name = installed.find((m) => m.id === id)?.label ?? id ?? t('model.localActive');
      return `${t('model.local')} · ${name}`;
    }
    return t('model.auto');
  }, [cloudName, config, installed]);

  const choose = useCallback(async (next: EngineChoice) => {
    const spec = engineSpecOf(next);
    setError(null);
    setNotice(null);
    if (spec.route !== 'local' || !spec.localModelId) {
      seq.current++;
      setChoice(next, labelOf(next));
      setStatus('idle');
      return;
    }
    const mine = ++seq.current;
    setStatus('loading');
    try {
      if (freeBeforeLoad) {
        await bridge.freeIdle().catch((err) => console.warn('[Translator] free before load failed:', err));
      }
      let res = await bridge.loadRitual(spec.localModelId);
      // No board to draw the dialog on (the cartridge in its own window): load
      // without it rather than refuse, and SAY the memory check was skipped.
      const plain = res.error === 'NO_RITUAL_HOST';
      if (plain) {
        const warm = await bridge.warmLocal(spec.localModelId);
        res = { loaded: warm.loaded, cancelled: false, error: warm.loaded ? null : (warm.error ?? null) };
      }
      if (mine !== seq.current) return;
      const o = ritualOutcome(res, plain);
      if (o.adopt) setChoice(next, labelOf(next));
      setStatus(o.status);
      setError(o.error ? ('key' in o.error ? t(o.error.key) : o.error.text) : null);
      setNotice(o.notice ? t(o.notice) : null);
    } catch (err) {
      if (mine !== seq.current) return;
      setStatus('error');
      const msg = err instanceof Error ? err.message : String(err);
      const key = loadErrorKey(msg);
      setError(key ? t(key) : (msg || t('model.loadFailed')));
    }
  }, [bridge, freeBeforeLoad, labelOf, setChoice]);

  const freeMemory = useCallback(async () => {
    const res = await bridge.freeIdle();
    if (res.unloaded.includes('llm')) setStatus((s) => (s === 'ready' ? 'idle' : s));
    return res.unloaded;
  }, [bridge]);

  return {
    choice,
    engine: engineSpecOf(choice),
    label: labelOf(choice),
    installed,
    config,
    cloudName,
    status,
    error,
    notice,
    choose,
    freeMemory,
    refresh,
    labelOf,
  };
}
