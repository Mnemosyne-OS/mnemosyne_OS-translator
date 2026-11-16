/**
 * report.ts — the Markdown a translated web page and a bench pass leave behind
 * (doc 214 §6, §7). The same text goes to the chat as a document, to the
 * Translator's vault, and to a `.md` file: one builder, three exits.
 *
 * The labels come from the caller (already translated with `t()`): this module
 * only lays them out, so it stays pure and testable.
 */
import { agreementPairs, charsPerSecond, lengthRatio, type EngineRun } from './bench';

export interface WebReportInput {
  url: string;
  title: string | null;
  published: string | null;
  sourceLang: string;
  targetLang: string;
  engineLabel: string;
  readAt: number;
  chunks: number;
  translated: string;
  original: string;
  /** The page text was cut at the host's ceiling. */
  truncated: boolean;
}

export interface WebReportLabels {
  heading: string; // e.g. "Translation"
  address: string;
  readOn: string;
  published: string;
  engine: string;
  pieces: string;
  truncated: string;
  translatedText: string;
  original: string;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The web page report. */
export function webReportMarkdown(r: WebReportInput, l: WebReportLabels): string {
  const title = r.title?.trim() || r.url;
  const meta = [
    `- ${l.address}: ${r.url}`,
    `- ${l.readOn}: ${isoDay(r.readAt)}`,
    r.published ? `- ${l.published}: ${r.published}` : '',
    `- ${l.engine}: ${r.engineLabel} · ${r.sourceLang} → ${r.targetLang} · ${r.chunks} ${l.pieces}`,
    r.truncated ? `- ⚠ ${l.truncated}` : '',
  ].filter(Boolean);
  return [
    `# ${title}`,
    '',
    `*${l.heading}*`,
    '',
    ...meta,
    '',
    `## ${l.translatedText}`,
    '',
    r.translated.trim(),
    '',
    `<details><summary>${l.original}</summary>`,
    '',
    r.original.trim(),
    '',
    '</details>',
    '',
  ].join('\n');
}

export interface BenchReportLabels {
  heading: string;
  engine: string;
  status: string;
  load: string;
  translate: string;
  speed: string;
  ratio: string;
  agreement: string;
  output: string;
  notMeasured: string;
  /** Status words, keyed by run status. */
  statuses: Record<EngineRun['status'], string>;
}

function secs(ms: number | null, none: string): string {
  return ms === null ? none : `${(ms / 1000).toFixed(1)} s`;
}

/** The bench report: one row per engine, the agreement of every pair, then each output. */
export function benchReportMarkdown(
  name: string,
  sourceLang: string,
  targetLang: string,
  sourceChars: number,
  runs: EngineRun[],
  l: BenchReportLabels,
  at: number,
): string {
  const none = l.notMeasured;
  const rows = runs.map((r) => {
    const cps = charsPerSecond(r);
    const ratio = lengthRatio(r, sourceChars);
    return `| ${r.label} | ${l.statuses[r.status]}${r.error ? ` (${r.error.replace(/\|/g, '/')})` : ''} | ${secs(r.loadMs, none)} | ${secs(r.translateMs, none)} | ${cps === null ? none : Math.round(cps)} | ${ratio === null ? none : ratio.toFixed(2)} |`;
  });
  const labelOf = new Map(runs.map((r) => [r.key, r.label]));
  const pairs = agreementPairs(runs).map((p) =>
    `- ${labelOf.get(p.a)} ↔ ${labelOf.get(p.b)}: ${p.score === null ? none : `${Math.round(p.score * 100)} %`}`);
  const outputs = runs.filter((r) => r.output).flatMap((r) => [`### ${r.label}`, '', r.output.trim(), '']);
  return [
    `# ${l.heading}: ${name}`,
    '',
    `${sourceLang} → ${targetLang} · ${sourceChars} chars · ${isoDay(at)}`,
    '',
    `| ${l.engine} | ${l.status} | ${l.load} | ${l.translate} | ${l.speed} | ${l.ratio} |`,
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    ...(pairs.length ? [`## ${l.agreement}`, '', ...pairs, ''] : []),
    `## ${l.output}`,
    '',
    ...outputs,
  ].join('\n');
}
