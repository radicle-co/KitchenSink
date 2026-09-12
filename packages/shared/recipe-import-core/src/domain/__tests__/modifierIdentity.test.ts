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

    /** ⛔ THE ANTI-OVER-REACH ASSERTION. These are things a cook DOES, and must stay preparation. */
    it.each(['sifted', 'chopped', 'grated', 'melted', 'beaten', 'boiled', 'minced', 'whipped'])(
        '%s names something DONE to the food, so it stays preparation',
        (word) => {
            expect(classifyModifier(word)).toBe('preparation');
        },
    );
});
