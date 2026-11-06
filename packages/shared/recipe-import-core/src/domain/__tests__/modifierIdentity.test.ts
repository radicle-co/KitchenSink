import { describe, it, expect } from 'vitest';
import { classifyModifier } from '../modifierLexicon.js';

/**
 * A past participle that names a form the cook BUYS is identity, not preparation
 * (owner ruling 2026-08-23 as refined 2026-08-26 — U23's oracle, gap A: 17 cases / 58 lines).
 */
describe('a purchasable form is identity, not preparation', () => {
    it.each(['granulated', 'powdered', 'canned', 'prepared', 'imported', 'unsweetened', 'candied'])(
        '%s names WHICH food, so it is identity',
        (word) => {
            expect(classifyModifier(word)).toBe('identity');
        },
    );

    /**
     * The rest of the parse prompt's "product descriptors" (`PARSE_SYSTEM_PROMPT` rule 7), each a form a cook buys.
     * `unsalted` is the dogfooding case: filed as preparation, it moved out of the name and the line bound to SALTED
     * butter. `sun-dried` is read whole, because its head `dried` is preparation by a separate, still-open ruling.
     */
    it.each([
        'salted',
        'unsalted',
        'smoked',
        'roasted',
        'sweetened',
        'condensed',
        'evaporated',
        'refried',
        'unbleached',
        'sun-dried',
        'Sun-Dried',
    ])('%s is a form the cook buys, so it is identity', (word) => {
        expect(classifyModifier(word)).toBe('identity');
    });

    /** ⛔ THE ANTI-OVER-REACH ASSERTION. These are things a cook DOES, and must stay preparation. */
    it.each(['sifted', 'chopped', 'grated', 'melted', 'beaten', 'boiled', 'minced', 'whipped', 'mixed'])(
        '%s names something DONE to the food, so it stays preparation',
        (word) => {
            expect(classifyModifier(word)).toBe('preparation');
        },
    );
});
