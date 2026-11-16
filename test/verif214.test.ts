/**
 * What the cold verifier pass of doc 214 found, held by tests: who waits for
 * whom, what a ritual answer says, what Free memory reports.
 */
import { blockedFor } from '../src/renderer/src/lib/busy';
import { loadErrorKey, ritualOutcome } from '../src/renderer/src/lib/ritual';
import { freedSummary, gbText, runtimeKindKey } from '../src/renderer/src/lib/runtimeNames';
import { chatError } from '../src/renderer/src/lib/errors';
import { t } from '../src/renderer/src/i18n';

describe('blockedFor (finding 2: both ways)', () => {
  it('the other tabs wait for a running bench', () => {
    expect(blockedFor('translate', { compare: true })).toBe(true);
    expect(blockedFor('documents', { compare: true })).toBe(true);
    expect(blockedFor('web', { compare: false })).toBe(false);
  });
  it('the bench waits for any other tab translating', () => {
    expect(blockedFor('compare', { documents: true })).toBe(true);
    expect(blockedFor('compare', { translate: false, web: true })).toBe(true);
    expect(blockedFor('compare', { compare: true })).toBe(false);
    expect(blockedFor('compare', {})).toBe(false);
  });
});

describe('ritualOutcome', () => {
  it('a load is adopted; a plain load (no board) says the check was skipped', () => {
    expect(ritualOutcome({ loaded: true, cancelled: false, error: null }, false)).toEqual({ status: 'ready', adopt: true, error: null, notice: null });
    expect(ritualOutcome({ loaded: true, cancelled: false, error: null }, true).notice).toBe('model.loadedNoRitual');
  });
  it('a cancel keeps the previous engine, an error is shown', () => {
    expect(ritualOutcome({ loaded: false, cancelled: true, error: null }, false)).toMatchObject({ status: 'idle', adopt: false, error: null });
    expect(ritualOutcome({ loaded: false, cancelled: false, error: 'RITUAL_BUSY' }, false).error).toEqual({ key: 'model.ritualBusy' });
    expect(ritualOutcome({ loaded: false, cancelled: false, error: 'Not enough memory' }, false).error).toEqual({ text: 'Not enough memory' });
    expect(ritualOutcome({ loaded: false, cancelled: false, error: null }, false).error).toEqual({ key: 'model.loadFailed' });
  });
  it('names a missing click and an old host', () => {
    expect(loadErrorKey('NOT_FROM_A_GESTURE')).toBe('model.needsClick');
    expect(loadErrorKey('Action model.loadRitual is not supported or not permitted.')).toBe('host.tooOld');
    expect(loadErrorKey('boom')).toBeNull();
  });
});

describe('freedSummary (finding 10: words and GB, never ids)', () => {
  const before = [
    { id: 'llm', approxBytes: 4 * 1024 ** 3 },
    { id: 'embed-gpu', approxBytes: 1024 ** 3 },
    { id: 'tts:xtts', approxBytes: null },
  ];
  it('names every engine by family and sums the known weights', () => {
    const s = freedSummary(['llm', 'embed-gpu'], before);
    expect(s.keys).toEqual(['runtime.kind.llm', 'runtime.kind.embed-gpu']);
    expect(s.bytes).toBe(5 * 1024 ** 3);
    expect(s.partial).toBe(false);
    expect(gbText(s.bytes!)).toBe('5.0');
  });
  it('an engine with no weight makes the sum a floor; none known says nothing', () => {
    expect(freedSummary(['llm', 'tts:xtts'], before)).toMatchObject({ bytes: 4 * 1024 ** 3, partial: true });
    expect(freedSummary(['tts:xtts'], before)).toMatchObject({ bytes: null, partial: false });
    expect(freedSummary(['llm'], null)).toMatchObject({ bytes: null });
  });
  it('maps families and unknown ids', () => {
    expect(runtimeKindKey('tts:piper')).toBe('runtime.kind.tts');
    expect(runtimeKindKey('tts-neural')).toBe('runtime.kind.tts');
    expect(runtimeKindKey('ocr:paddle')).toBe('runtime.kind.ocr');
    expect(runtimeKindKey('mystery')).toBe('runtime.kind.other');
  });
});

describe('chatError (finding 1: a window with no board says so)', () => {
  it('CHAT_UNHEARD is said in words, a missing click too', () => {
    // The interface language follows the machine here: compare to the KEY's sentence, whatever it is.
    expect(chatError(new Error('CHAT_UNHEARD'))).toBe(t('chat.notOnBoard'));
    expect(chatError(new Error('NOT_FROM_A_GESTURE'))).toBe(t('chat.needsClick'));
  });
});
