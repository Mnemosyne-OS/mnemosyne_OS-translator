/**
 * useChunkedTranslate — a long text translated piece by piece (doc 214 D5),
 * with visible progress and a Stop honoured between two pieces.
 *
 * Each screen owns its own instance: the Translate tab, a document job and the
 * web page do not share one progress bar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineSpec, TranslatorBridge } from './useBridge';
import { joinChunks, splitIntoChunks } from '../lib/chunk';

export interface ChunkProgress {
  done: number;
  total: number;
}

export interface ChunkedResult {
  text: string;
  chunks: number;
  /** Stopped before the last piece: `text` holds what was done. */
  stopped: boolean;
}

export interface ChunkedTranslateApi {
  busy: boolean;
  progress: ChunkProgress | null;
  run: (
    text: string,
    sourceLang: string,
    targetLang: string,
    engine: EngineSpec,
    chunkChars: number,
    onPartial?: (soFar: string) => void,
  ) => Promise<ChunkedResult>;
  stop: () => void;
}

export function useChunkedTranslate(bridge: TranslatorBridge): ChunkedTranslateApi {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ChunkProgress | null>(null);
  const stopRef = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopRef.current = true;
    };
  }, []);

  const run = useCallback<ChunkedTranslateApi['run']>(async (text, sourceLang, targetLang, engine, chunkChars, onPartial) => {
    const chunks = splitIntoChunks(text, chunkChars);
    stopRef.current = false;
    setBusy(true);
    setProgress({ done: 0, total: chunks.length });
    const parts: string[] = [];
    try {
      for (let i = 0; i < chunks.length; i++) {
        if (stopRef.current) return { text: joinChunks(parts), chunks: chunks.length, stopped: true };
        parts.push(await bridge.translatePiece(chunks[i]!, sourceLang, targetLang, engine, { index: i, total: chunks.length }));
        if (!alive.current) break;
        setProgress({ done: i + 1, total: chunks.length });
        onPartial?.(joinChunks(parts));
      }
      return { text: joinChunks(parts), chunks: chunks.length, stopped: parts.length < chunks.length };
    } finally {
      if (alive.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }, [bridge]);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  return { busy, progress, run, stop };
}
