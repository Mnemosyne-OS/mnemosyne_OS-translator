/**
 * Translator Bridge — cartridge-to-host communication via postMessage.
 *
 * The cartridge drives the host's generic `model.infer` (with `disableRAG:
 * true`): a translation must not be steered by unrelated memories, and the
 * cartridge owns the whole prompt (lib/translatePrompt).
 *
 * Doc 214 adds the host doors the rework needs: the chat's loading ritual
 * (`model.loadRitual`), what is resident and freeing it (`runtime.*`), reading
 * a web page on this machine (`web.readPage`), handing a report to the chat
 * (`chat.attachDocument`), and the durable state the far view reads.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { buildTranslatePrompt, cleanTranslation, isEcho } from '../lib/translatePrompt';
import { t } from '../i18n';

const PLUGIN_ID = '@mnemosyne-plugins/translator';
const REQUEST_TIMEOUT_MS = 60_000;
// Document extraction can spin up an OCR sidecar and grind through many pages.
const EXTRACT_TIMEOUT_MS = 900_000; // 15 min — OCR on a large scanned PDF
const INFER_TIMEOUT_MS = 300_000; //  5 min — one piece on an already-loaded model
// A local model may cold-load (spawn worker + read GGUF into RAM), which the host
// caps at ~10 min. Use a ceiling above that so a slow first load is not cut short.
const LOCAL_LOAD_TIMEOUT_MS = 720_000; // 12 min
// The ritual waits for the person: they read the memory figures and choose.
const RITUAL_TIMEOUT_MS = 1_800_000; // 30 min
// The FIRST permission-gated call can open the host's native authorization
// dialog and wait for the human's click — a short bound races them.
const PERMISSION_PACED_TIMEOUT_MS = 300_000; // 5 min

/**
 * Best-effort host origin for a targeted postMessage — never broadcast to '*'.
 * Falls back to '*' only for opaque/file:// hosts (the host validates the source).
 */
function resolveHostOrigin(): string {
  const usable = (o: string | null | undefined): o is string => !!o && o !== 'null' && o !== 'file://';
  try {
    const ao = window.location.ancestorOrigins?.[0];
    if (usable(ao)) return ao;
  } catch (err) {
    console.warn('[Translator] ancestorOrigins unavailable:', err);
  }
  try {
    if (document.referrer) {
      const o = new URL(document.referrer).origin;
      if (usable(o)) return o;
    }
  } catch (err) {
    console.warn('[Translator] referrer unreadable:', err);
  }
  return '*';
}
const MNEMO_HOST_ORIGIN = resolveHostOrigin();

type PendingResolve = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingRequests = new Map<string, PendingResolve>();
let listenerAttached = false;
let reqCounter = 0;

function attachGlobalListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window.parent) return; // only the host frame may answer
    if (e.data?.type !== 'MNEMO_PLUGIN_REPLY') return;
    const { messageId, success, data, error } = e.data;
    const pending = pendingRequests.get(messageId);
    if (!pending) return;
    pendingRequests.delete(messageId);
    clearTimeout(pending.timer);
    if (success) pending.resolve(data);
    else pending.reject(new Error(error || 'Bridge error'));
  });
}

function sendRequest(action: string, payload?: unknown, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<unknown> {
  attachGlobalListener();
  const messageId = `translator-${++reqCounter}-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(messageId);
      reject(new Error(`Bridge timeout: ${action}`));
    }, timeoutMs);
    pendingRequests.set(messageId, { resolve, reject, timer });
    window.parent.postMessage(
      { type: 'MNEMO_PLUGIN_REQUEST', pluginId: PLUGIN_ID, messageId, action, payload },
      MNEMO_HOST_ORIGIN,
    );
  });
}

/** Shape returned by the host's `model.infer` action. */
interface InferReply {
  success?: boolean;
  error?: string;
  text?: string;
  response?: string;
}

export type ForceMode = 'local' | 'cloud';

/** Which engine runs a call. `auto` leaves the routing to the app. */
export interface EngineSpec {
  route: 'auto' | 'local' | 'cloud';
  localModelId?: string;
}

export interface InferOptions {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  engine: EngineSpec;
}

/** Subset of the host model config the cartridge reads. */
export interface ModelConfig {
  mode?: string;
  local?: { activeModel?: string };
  cloud?: { provider?: string; model?: string };
}

/** One installed local model. */
export interface LocalModelInfo {
  id: string;
  label: string;
  sizeBytes: number;
  minRamGb: number;
  task: string;
}

/** One engine resident in memory (host `runtime:list`). */
export interface ResidentRuntime {
  id: string;
  kind: string;
  detail: string | null;
  busy: boolean;
  approxBytes: number | null;
}

export interface RitualResult {
  loaded: boolean;
  cancelled: boolean;
  error: string | null;
}

export interface WebPage {
  url: string;
  title: string | null;
  published: string | null;
  text: string;
  truncated: boolean;
}

export interface SandboxInfo { vault: string; created: boolean; unlocked: boolean; }
export interface VaultTile { icon?: string; metrics?: { label: string; spine?: string }[]; }
export interface FileFilter { name: string; extensions: string[]; }
export interface ExtractedDoc { text: string; name: string; ocrUsed: boolean; truncated: boolean; }

export interface TranslatorBridge {
  connected: boolean;
  /** Raw model inference with RAG disabled — the cartridge owns the prompt. */
  infer: (opts: InferOptions) => Promise<string>;
  /** Translates ONE piece (callers cut long texts with lib/chunk). */
  translatePiece: (
    text: string,
    sourceLang: string,
    targetLang: string,
    engine: EngineSpec,
    part?: { index: number; total: number },
  ) => Promise<string>;
  getModelConfig: () => Promise<ModelConfig>;
  getInstalledModels: () => Promise<LocalModelInfo[]>;
  /** Loads a local model without the ritual (the bench, the far view). */
  warmLocal: (id: string) => Promise<{ loaded: boolean; error?: string }>;
  /** The chat's loading ritual, drawn by the host: memory check, what to unload, load. */
  loadRitual: (id: string) => Promise<RitualResult>;
  runtimeList: () => Promise<ResidentRuntime[]>;
  /** Unloads every idle engine; returns what went. */
  freeIdle: () => Promise<{ unloaded: string[]; skipped: string[] }>;
  /** Unloads the local language model when idle. */
  unloadLlm: () => Promise<boolean>;
  readPage: (url: string) => Promise<WebPage>;
  /** Puts a document in the chat (top chat, or a new one) with a draft. Needs a click in the frame. Returns whether the host cut it. */
  attachToChat: (doc: { name: string; text: string; draft?: string }) => Promise<{ truncated: boolean }>;
  stateGet: () => Promise<Record<string, unknown> | null>;
  stateSet: (state: Record<string, unknown>) => Promise<void>;
  pickFile: (filters?: FileFilter[]) => Promise<string | null>;
  extractDocument: (filePath: string, forceOcr?: boolean) => Promise<ExtractedDoc>;
  ensureSandbox: () => Promise<SandboxInfo>;
  describeVaultTile: (tile: VaultTile) => Promise<{ tile: unknown }>;
  socialIngest: (vault: string, content: string, spineType?: string) => Promise<unknown>;
}

/** The host replies `{ success, data }` for the newer doors: unwrap or throw its error. */
function unwrap<T>(res: unknown, action: string): T {
  const r = res as { success?: boolean; data?: T; error?: string } | undefined;
  if (!r || r.success === false) throw new Error(r?.error || `${action} failed`);
  return (r.data ?? (res as T));
}

export function useTranslatorBridge(): TranslatorBridge {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    window.parent.postMessage(
      { type: 'MNEMO_PLUGIN_TITLE', pluginId: PLUGIN_ID, title: 'Translator' },
      MNEMO_HOST_ORIGIN,
    );
    sendRequest('getStatus')
      .then(() => setConnected(true))
      .catch((err) => {
        console.warn('[Translator] bridge not reachable:', err);
        setConnected(false);
      });
    return () => {
      window.parent.postMessage({ type: 'MNEMO_PLUGIN_TITLE', pluginId: null, title: null }, MNEMO_HOST_ORIGIN);
    };
  }, []);

  const infer = useCallback(async (opts: InferOptions): Promise<string> => {
    const { engine } = opts;
    const local = engine.route === 'local';
    const res = (await sendRequest('model.infer', {
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      temperature: opts.temperature ?? 0.2,
      maxTokens: opts.maxTokens ?? 4096,
      stream: false,
      disableRAG: true, // a translator must not be steered by unrelated memories
      receiptSurface: 'translator', // Settings › Harness files it apart from the chat (the far view says the same)
      ...(engine.route !== 'auto' ? { forceMode: engine.route } : {}),
      ...(local && engine.localModelId ? { localModelId: engine.localModelId } : {}),
    }, local ? LOCAL_LOAD_TIMEOUT_MS : INFER_TIMEOUT_MS)) as InferReply | string | undefined;
    if (res && typeof res === 'object' && res.success === false) {
      throw new Error(res.error || 'Inference failed');
    }
    return typeof res === 'string' ? res : (res?.text || res?.response || '');
  }, []);

  const translatePiece = useCallback(
    async (text: string, sourceLang: string, targetLang: string, engine: EngineSpec, part?: { index: number; total: number }) => {
      const { systemPrompt, prompt } = buildTranslatePrompt(text, sourceLang, targetLang, part);
      // Room for the answer: European text runs ~0.3 token per character and a
      // translation grows it by up to a third; CJK runs near 1 token per
      // character. 1.2 tokens per source character covers both, floor 512.
      const maxTokens = Math.min(8192, Math.max(512, Math.ceil(text.length * 1.2)));
      const raw = await infer({ prompt, systemPrompt, temperature: 0.2, maxTokens, engine });
      const out = cleanTranslation(raw, text.length);
      // A copy of the source is not a translation: said, never shown or filed as one.
      // Only when both languages are known and differ (an undetected source may be
      // the target already), and only for a text sent whole: a piece of a document
      // can rightly come back unchanged (a code block, a section already in the
      // target), and one refused piece would stop the whole document.
      const whole = !part || part.total <= 1;
      if (whole && sourceLang !== 'auto' && sourceLang !== targetLang && isEcho(text, out)) {
        throw new Error(t('translate.echo'));
      }
      return out;
    },
    [infer],
  );

  const getModelConfig = useCallback(async (): Promise<ModelConfig> => {
    const res = (await sendRequest('model.getConfig')) as ModelConfig | undefined;
    return res && typeof res === 'object' ? res : {};
  }, []);

  const getInstalledModels = useCallback(async (): Promise<LocalModelInfo[]> => {
    const res = (await sendRequest('model.getInstalled')) as unknown;
    if (!Array.isArray(res)) return [];
    return res
      .map((m): LocalModelInfo | null => {
        if (!m || typeof m !== 'object') return null;
        const o = m as Record<string, unknown>;
        if (typeof o.id !== 'string') return null;
        return {
          id: o.id,
          label: typeof o.label === 'string' ? o.label : o.id,
          sizeBytes: typeof o.sizeBytes === 'number' ? o.sizeBytes : 0,
          minRamGb: typeof o.minRamGb === 'number' ? o.minRamGb : 0,
          task: typeof o.task === 'string' ? o.task : 'chat',
        };
      })
      .filter((m): m is LocalModelInfo => m !== null)
      // Only text-generation engines make sense for translation.
      .filter((m) => m.task === 'chat' || m.task === 'code');
  }, []);

  const warmLocal = useCallback(async (id: string): Promise<{ loaded: boolean; error?: string }> => {
    const res = (await sendRequest('model.warmLocal', { id }, LOCAL_LOAD_TIMEOUT_MS)) as
      | { success?: boolean; loaded?: boolean; error?: string }
      | undefined;
    if (!res || res.success === false) return { loaded: false, error: res?.error || 'Model failed to load' };
    return { loaded: res.loaded !== false, error: res.error };
  }, []);

  const loadRitual = useCallback(async (id: string): Promise<RitualResult> => {
    const res = (await sendRequest('model.loadRitual', { id }, RITUAL_TIMEOUT_MS)) as Partial<RitualResult> | undefined;
    return {
      loaded: res?.loaded === true,
      cancelled: res?.cancelled === true,
      error: typeof res?.error === 'string' ? res.error : null,
    };
  }, []);

  const runtimeList = useCallback(async (): Promise<ResidentRuntime[]> => {
    const data = unwrap<{ runtimes?: ResidentRuntime[] }>(await sendRequest('runtime.list'), 'runtime.list');
    return Array.isArray(data?.runtimes) ? data.runtimes : [];
  }, []);

  const freeIdle = useCallback(async () => {
    const data = unwrap<{ unloaded?: string[]; skipped?: string[] }>(await sendRequest('runtime.unloadIdle'), 'runtime.unloadIdle');
    return { unloaded: data?.unloaded ?? [], skipped: data?.skipped ?? [] };
  }, []);

  const unloadLlm = useCallback(async () => {
    const data = unwrap<{ dropped?: boolean }>(await sendRequest('runtime.unloadLlm'), 'runtime.unloadLlm');
    return data?.dropped === true;
  }, []);

  const readPage = useCallback(async (url: string): Promise<WebPage> => {
    const d = unwrap<Partial<WebPage>>(await sendRequest('web.readPage', { url }, 60_000), 'web.readPage');
    return {
      url: typeof d.url === 'string' ? d.url : url,
      title: typeof d.title === 'string' ? d.title : null,
      published: typeof d.published === 'string' ? d.published : null,
      text: typeof d.text === 'string' ? d.text : '',
      truncated: d.truncated === true,
    };
  }, []);

  const attachToChat = useCallback(async (doc: { name: string; text: string; draft?: string }) => {
    const res = (await sendRequest('chat.attachDocument', doc)) as { truncated?: boolean } | undefined;
    return { truncated: res?.truncated === true };
  }, []);

  const stateGet = useCallback(async () => {
    const res = (await sendRequest('state.get')) as { state?: Record<string, unknown> | null } | undefined;
    return res?.state ?? null;
  }, []);

  const stateSet = useCallback(async (state: Record<string, unknown>) => {
    await sendRequest('state.set', { state });
  }, []);

  const pickFile = useCallback(async (filters?: FileFilter[]): Promise<string | null> => {
    const res = (await sendRequest('dialog.selectFile', { filters })) as string | null | undefined;
    return typeof res === 'string' && res ? res : null;
  }, []);

  const extractDocument = useCallback(async (filePath: string, forceOcr = false): Promise<ExtractedDoc> => {
    const res = (await sendRequest('reader.extractDocument', { filePath, forceOcr }, EXTRACT_TIMEOUT_MS)) as
      | { success?: boolean; error?: string; data?: Partial<ExtractedDoc> }
      | undefined;
    if (!res || res.success === false || !res.data) throw new Error(res?.error || 'Could not read that document');
    const d = res.data;
    return {
      text: typeof d.text === 'string' ? d.text : '',
      name: typeof d.name === 'string' ? d.name : '',
      ocrUsed: d.ocrUsed === true,
      truncated: d.truncated === true,
    };
  }, []);

  const ensureSandbox = useCallback(
    () => sendRequest('vault.sandbox.ensure', {}, PERMISSION_PACED_TIMEOUT_MS) as Promise<SandboxInfo>,
    [],
  );

  const describeVaultTile = useCallback(
    (tile: VaultTile) => sendRequest('vault.sandbox.describeTile', tile) as Promise<{ tile: unknown }>,
    [],
  );

  const socialIngest = useCallback(
    (vault: string, content: string, spineType = 'SOCIAL_NODE') =>
      sendRequest('social.ingest', { vault, content, spineType }),
    [],
  );

  return useMemo(
    () => ({
      connected, infer, translatePiece, getModelConfig, getInstalledModels, warmLocal, loadRitual,
      runtimeList, freeIdle, unloadLlm, readPage, attachToChat, stateGet, stateSet,
      pickFile, extractDocument, ensureSandbox, describeVaultTile, socialIngest,
    }),
    [connected, infer, translatePiece, getModelConfig, getInstalledModels, warmLocal, loadRitual,
      runtimeList, freeIdle, unloadLlm, readPage, attachToChat, stateGet, stateSet,
      pickFile, extractDocument, ensureSandbox, describeVaultTile, socialIngest],
  );
}
