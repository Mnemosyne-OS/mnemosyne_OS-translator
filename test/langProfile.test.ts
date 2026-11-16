/**
 * "My languages" (doc 214 §9). Run with the globals flag (the cartridge has no
 * vitest of its own): `../mnemo-budget/node_modules/.bin/vitest run --globals test/langProfile.test.ts`.
 */
import {
  chipTarget, defaultProfile, detectLang, normalizeProfile, pickTarget, promoteMine, setPair, toggleMine,
  type LangProfile,
} from '../src/renderer/src/lib/langProfile';

const tony: LangProfile = { mine: ['es', 'en', 'fr'], pair: ['en', 'es'] };

describe('pickTarget', () => {
  it('sends one side of the pair to the other', () => {
    expect(pickTarget(tony, 'en', 'fr')).toBe('es');
    expect(pickTarget(tony, 'es', 'fr')).toBe('en');
  });
  it('sends another of my languages to the first of mine that is not it', () => {
    expect(pickTarget(tony, 'fr', 'en')).toBe('es');
  });
  it('sends a foreign language to the first of mine', () => {
    expect(pickTarget(tony, 'de', 'en')).toBe('es');
  });
  it('keeps the target when the source is unknown', () => {
    expect(pickTarget(tony, null, 'fr')).toBe('fr');
  });
});

describe('chipTarget', () => {
  it('a chip becomes the target', () => {
    expect(chipTarget('en', 'es', 'fr')).toEqual({ source: 'en', target: 'fr' });
  });
  it('clicking the chip of the source swaps rather than translating into itself', () => {
    expect(chipTarget('en', 'es', 'en')).toEqual({ source: 'es', target: 'en' });
  });
  it('clicking the current target swaps a known pair', () => {
    expect(chipTarget('en', 'es', 'es')).toEqual({ source: 'es', target: 'en' });
  });
  it('clicking the current target with an auto source changes nothing', () => {
    expect(chipTarget('auto', 'es', 'es')).toEqual({ source: 'auto', target: 'es' });
  });
});

describe('normalizeProfile', () => {
  it('drops unknown codes and duplicates', () => {
    expect(normalizeProfile({ mine: ['es', 'xx', 'es', 'en'], pair: ['en', 'es'] }, 'fr'))
      .toEqual({ mine: ['es', 'en'], pair: ['en', 'es'] });
  });
  it('rebuilds a pair that is not inside mine', () => {
    expect(normalizeProfile({ mine: ['es', 'en', 'fr'], pair: ['de', 'es'] }, 'fr').pair).toEqual(['es', 'en']);
  });
  it('completes a single language with a second one', () => {
    expect(normalizeProfile({ mine: ['fr'] }, 'fr').mine).toEqual(['fr', 'en']);
  });
  it('falls back to the default on garbage', () => {
    expect(normalizeProfile('nope', 'fr')).toEqual(defaultProfile('fr'));
    expect(normalizeProfile(null, 'xx')).toEqual(defaultProfile('en'));
  });
});

describe('editing the profile', () => {
  it('toggleMine refuses to go below two languages', () => {
    const two: LangProfile = { mine: ['en', 'es'], pair: ['en', 'es'] };
    expect(toggleMine(two, 'en')).toBe(two);
  });
  it('removing a pair side repairs the pair', () => {
    expect(toggleMine(tony, 'en')).toEqual({ mine: ['es', 'fr'], pair: ['es', 'fr'] });
  });
  it('adding appends', () => {
    expect(toggleMine(tony, 'de').mine).toEqual(['es', 'en', 'fr', 'de']);
  });
  it('promote moves one place earlier', () => {
    expect(promoteMine(tony, 'fr').mine).toEqual(['es', 'fr', 'en']);
    expect(promoteMine(tony, 'es')).toBe(tony);
  });
  it('setPair refuses outsiders and twins', () => {
    expect(setPair(tony, 'de', 'es')).toBe(tony);
    expect(setPair(tony, 'es', 'es')).toBe(tony);
    expect(setPair(tony, 'fr', 'es').pair).toEqual(['fr', 'es']);
  });
});

describe('detectLang', () => {
  it('reads English, French and Spanish sentences', () => {
    expect(detectLang('The cat is on the table and it is not happy with the dog.')).toBe('en');
    expect(detectLang('Le chat est sur la table et il ne veut pas descendre avec nous.')).toBe('fr');
    expect(detectLang('El gato está en la mesa y no quiere bajar con los niños.')).toBe('es');
  });
  it('reads a script at once', () => {
    expect(detectLang('Привет, как дела?')).toBe('ru');
  });
  it('says it does not know on thin evidence', () => {
    expect(detectLang('OK')).toBeNull();
    expect(detectLang('')).toBeNull();
    // ONE marker word decides nothing (the floor is 2, the far view's too).
    expect(detectLang('the station')).toBeNull();
  });
  it('reads a short question with two marker words, like the far view does', () => {
    expect(detectLang('Where is the station?')).toBe('en');
    expect(detectLang('Où est la gare ?')).toBe('fr');
  });
});
