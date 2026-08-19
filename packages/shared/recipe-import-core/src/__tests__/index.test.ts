/**
 * The package door (CODING_STANDARDS §1 "Barrel `index.ts` files MUST contain only named re-exports.
 * `export *` is NOT a named re-export and is therefore prohibited").
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | §1 — the public API is EXPLICIT, so nothing leaks by accident | "exports exactly" |
 *
 * A snapshot of the export names is the only thing that catches an `export *` regression: the barrel
 * would still compile, still pass every other suite, and would silently publish the lexicon, the
 * pre-normalizer's internals and any future private helper as public API — which the `exports` map
 * then makes permanent.
 */
import { describe, it, expect } from 'vitest';

import * as publicApi from '../index.js';

describe('@kitchensink/recipe-import-core barrel', () => {
    it('exports exactly the named public surface, and nothing else', () => {
        expect(Object.keys(publicApi).sort()).toEqual([
            'normalizeDurationToMinutes',
            'normalizeQuantity',
            'normalizeServings',
            'parseIngredientLine',
            'sanitizeToPlainText',
        ]);
    });

    it('exports every entry point as a function', () => {
        for (const [name, value] of Object.entries(publicApi)) {
            expect(typeof value, `${name} should be a function`).toBe('function');
        }
    });

    it('does not re-export the lexicon, which is an implementation detail of the pre-normalizer', () => {
        expect(Object.keys(publicApi)).not.toContain('WHOLE_NUMBER_WORDS');
        expect(Object.keys(publicApi)).not.toContain('FRACTION_WORD_DENOMINATORS');
    });
});
