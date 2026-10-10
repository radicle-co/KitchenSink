/**
 * The badge copy for an ingredient line's resolution status (U14, F19 in `docs/design/uiOverhaul/evaluateFinal.md`).
 *
 * `resolutionStatusLabel` is an exhaustive switch with no default branch: a status added to the union is a compile
 * error rather than a line that renders a blank badge. That property is worth nothing if the test only covers the
 * arms that existed when it was written, so the table below is keyed over the union itself and a second test fails
 * when the union grows past the table.
 *
 * The words are the glossary's (`buildSpec.md` §2.1): the page and the editor's rows say the same thing, so each
 * status that the editor's row names reads the editor's own `rowState*` key, not a second copy of the word.
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { recipeFormMessages } from '../messages.js';
import { resolutionStatusLabel } from '../props.js';

const en = recipeFormMessages.en;

/** Every status, and the exact word it must show. */
const EXPECTED: Record<FoodResolutionStatus, string> = {
    [FoodResolutionStatus.PENDING]: en.rowStateLookingUp,
    [FoodResolutionStatus.UNRESOLVED]: en.rowStateChooseMatch,
    [FoodResolutionStatus.RESOLVED]: en.statusResolved,
    [FoodResolutionStatus.NOT_FOUND]: en.rowStateNoMatch,
    [FoodResolutionStatus.FAILED]: en.rowStateLookupFailed,
    [FoodResolutionStatus.NEEDS_REVIEW]: en.statusNeedsReview,
    [FoodResolutionStatus.PENDING_VERIFICATION]: en.statusPendingVerification,
    [FoodResolutionStatus.AMBIGUOUS]: en.rowStateChooseMatch,
    [FoodResolutionStatus.RESOLVED_UNAVAILABLE]: en.statusResolvedUnavailable,
    [FoodResolutionStatus.FOOD_REMOVED]: en.rowStateFoodRemoved,
    [FoodResolutionStatus.FOOD_UNREACHABLE]: en.statusFoodUnreachable,
};

/** The words glossary §2.1 retires, and the other retired words the old catalogue carried. */
const RETIRED = ['Needs a pick', 'Not resolved', 'Resolution failed', 'Resolving…', 'Resolving...'];

describe('resolutionStatusLabel', () => {
    it('is keyed over every status in the union', () => {
        expect(Object.keys(EXPECTED).sort()).toEqual(Object.values(FoodResolutionStatus).sort());
    });

    it.each(Object.values(FoodResolutionStatus))('says the glossary word for %s', (status) => {
        expect(resolutionStatusLabel(en, status)).toBe(EXPECTED[status]);
    });

    it.each(Object.values(FoodResolutionStatus))('never says a retired word for %s', (status) => {
        const label = resolutionStatusLabel(en, status);

        expect(label).toMatch(/\S/);
        expect(RETIRED).not.toContain(label);
    });

    it('spells the editor row’s words exactly (the glossary: Choose a match, No match found, Couldn’t look up)', () => {
        expect(resolutionStatusLabel(en, FoodResolutionStatus.AMBIGUOUS)).toBe('Choose a match');
        expect(resolutionStatusLabel(en, FoodResolutionStatus.NOT_FOUND)).toBe('No match found');
        expect(resolutionStatusLabel(en, FoodResolutionStatus.FAILED)).toBe('Couldn’t look up');
        expect(resolutionStatusLabel(en, FoodResolutionStatus.FOOD_REMOVED)).toBe('Food no longer listed');
        expect(resolutionStatusLabel(en, FoodResolutionStatus.PENDING)).toBe('Looking it up…');
    });

    it('keeps the states a cook acts on apart from the ones that are only information', () => {
        // A gate-contradicted line HAS a food: the cook's move is to re-pick, so it must not read like a dead end.
        expect(resolutionStatusLabel(en, FoodResolutionStatus.NEEDS_REVIEW)).not.toBe(
            resolutionStatusLabel(en, FoodResolutionStatus.NOT_FOUND),
        );
        // KTD-A's in-flight check is calm, and is not the lookup's own wait.
        expect(resolutionStatusLabel(en, FoodResolutionStatus.PENDING_VERIFICATION)).not.toBe(
            resolutionStatusLabel(en, FoodResolutionStatus.PENDING),
        );
        // An outage is never a permanent fact about the recipe, and a private food is not an error.
        const outage = resolutionStatusLabel(en, FoodResolutionStatus.FOOD_UNREACHABLE);

        expect(outage).not.toBe(resolutionStatusLabel(en, FoodResolutionStatus.FOOD_REMOVED));
        expect(outage).not.toBe(resolutionStatusLabel(en, FoodResolutionStatus.FAILED));
        expect(resolutionStatusLabel(en, FoodResolutionStatus.RESOLVED_UNAVAILABLE)).not.toBe(
            resolutionStatusLabel(en, FoodResolutionStatus.FOOD_REMOVED),
        );
    });
});
