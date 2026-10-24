/**
 * The collection sheet's display caps (`docs/architecture/uiOverhaulBlueprint.md` A12, `buildSpec.md` §5.1): 80 for the
 * name and 280 for the description, a counter from 60, all stricter than the wire's own bounds and never looser — the
 * same invariant `form/limits.ts` holds for the recipe editor.
 */
import { MAX_COLLECTION_DESCRIPTION_LENGTH, MAX_COLLECTION_NAME_LENGTH } from '@kitchensink/schema-recipe';
import { describe, expect, it } from 'vitest';

import {
    COLLECTION_DESCRIPTION_MAX_LENGTH,
    COLLECTION_NAME_COUNTER_FROM,
    COLLECTION_NAME_MAX_LENGTH,
    showsNameCounter,
} from '../limits.js';

describe('collection display caps', () => {
    it('are the build spec’s 80 and 280', () => {
        expect(COLLECTION_NAME_MAX_LENGTH).toBe(80);
        expect(COLLECTION_DESCRIPTION_MAX_LENGTH).toBe(280);
    });

    it('are stricter than the wire, never looser', () => {
        expect(COLLECTION_NAME_MAX_LENGTH).toBeLessThanOrEqual(MAX_COLLECTION_NAME_LENGTH);
        expect(COLLECTION_DESCRIPTION_MAX_LENGTH).toBeLessThanOrEqual(MAX_COLLECTION_DESCRIPTION_LENGTH);
    });

    it.each([
        [0, false],
        [59, false],
        [60, true],
        [80, true],
    ])('a %i-character name shows the counter: %s', (length, shown) => {
        expect(COLLECTION_NAME_COUNTER_FROM).toBe(60);
        expect(showsNameCounter('x'.repeat(length))).toBe(shown);
    });
});
