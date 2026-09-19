/**
 * KTD-11b's VOCABULARY, and the two traps that were hit while the ruling was verified.
 *
 * The ruling is a DEFINITION, not a claim about English: a past participle is preparation, an adjective is
 * identity, and a temperature is preparation — the middle case committed deliberately. What is under test
 * here is the vocabulary that carries it, because the plan records two ways a naive implementation gets it
 * wrong and both of them look right until they are run.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | KTD-11b — a past participle is preparation | "files a regular past participle as preparation" |
 * | KTD-11b — an adjective is identity | "files an adjective as identity" |
 * | KTD-11b — a temperature is preparation | "files a temperature as preparation, against the grammar" |
 * | KTD-11b trap 1 — `red`/`green` end in `-ed`/`-en` and are COLOURS | "does not mistake a colour for a participle" |
 * | KTD-11b trap 2 — `-ed` alone is not a participle test | "files an irregular participle a suffix test misses" |
 * | U16 — `large`/`small` are adjectives, which is why the contract has no `size` member | "files the CRF size vocabulary as identity" |
 * | U19 — an adverb travels with the participle it qualifies | "marks an adverb as a qualifier rather than deciding for it" |
 * | Totality — an unknown word is left where the engine put it | "leaves an unknown word unclassified" |
 *
 * ⚠️ The colour and irregular cases are the mutation-sensitive ones: delete the exception list and `red`
 * becomes preparation; delete the irregular list and `ground` becomes unclassified. Both are asserted
 * positively AND against their opposite, so neither can pass by accident.
 */
import { describe, it, expect } from 'vitest';

import { classifyModifier } from '../modifierLexicon.js';

describe('classifyModifier — KTD-11b, as a vocabulary', () => {
    it('files a regular past participle as preparation', () => {
        for (const word of ['chopped', 'grated', 'melted', 'sifted', 'minced', 'stoned', 'shredded', 'dried']) {
            expect(classifyModifier(word), word).toBe('preparation');
        }
    });

    it('files an adjective as identity', () => {
        for (const word of ['sweet', 'brown', 'pastry', 'Russian', 'fresh', 'Italian']) {
            expect(classifyModifier(word), word).toBe('identity');
        }
    });

    it('files a temperature as preparation, against the grammar', () => {
        // ⛔ Every one of these is an ADJECTIVE to any part-of-speech tagger. KTD-11b files them as
        // preparation anyway, deliberately — which is precisely why a tagger cannot implement this ruling.
        for (const word of ['hot', 'cold', 'boiling', 'lukewarm', 'warm']) {
            expect(classifyModifier(word), word).toBe('preparation');
        }
    });

    it('does not mistake a colour for a participle', () => {
        expect(classifyModifier('red')).toBe('identity');
        expect(classifyModifier('green')).toBe('identity');
        // The positive half of the pair: the suffix rule the exception list overrides really is there.
        expect(classifyModifier('boiled')).toBe('preparation');
    });

    it('files an irregular participle a suffix test misses', () => {
        for (const word of ['cut', 'ground', 'beaten']) {
            expect(classifyModifier(word), word).toBe('preparation');
        }

        // The negative half: none of the three ends in `-ed`, so a suffix-only rule would leave them
        // unclassified and the placement canonicalisation would never fire.
        for (const word of ['cut', 'ground', 'beaten']) {
            expect(word.endsWith('ed'), word).toBe(false);
        }
    });

    it('files the CRF size vocabulary as identity', () => {
        for (const word of ['large', 'small', 'medium']) {
            expect(classifyModifier(word), word).toBe('identity');
        }
    });

    it('marks an adverb as a qualifier rather than deciding for it', () => {
        for (const word of ['finely', 'coarsely', 'freshly', 'well']) {
            expect(classifyModifier(word), word).toBe('qualifier');
        }
    });

    it('leaves an unknown word unclassified', () => {
        for (const word of ['onions', 'flour', 'kettle', '']) {
            expect(classifyModifier(word), word).toBe('unclassified');
        }
    });

    it('reads a hyphenated compound by its head, so `well-beaten` is preparation', () => {
        expect(classifyModifier('well-beaten')).toBe('preparation');
        expect(classifyModifier('half-boiled')).toBe('preparation');
        // ...and a compound whose head is a noun stays unclassified, so the rule cannot over-reach.
        expect(classifyModifier('wine-glass')).toBe('unclassified');
    });

    it('is case- and punctuation-insensitive, because an engine returns the source spelling', () => {
        expect(classifyModifier('Chopped')).toBe('preparation');
        expect(classifyModifier('chopped,')).toBe('preparation');
        expect(classifyModifier('  GROUND ')).toBe('preparation');
    });
});
