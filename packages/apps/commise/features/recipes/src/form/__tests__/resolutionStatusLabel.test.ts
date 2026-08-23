/**
 * U14 — the badge copy for an ingredient line's resolution status, and the one status that is OURS.
 *
 * `resolutionStatusLabel` is an exhaustive switch with no default branch: a status added to the union is a
 * compile error rather than a line that renders a blank badge. That property is worth nothing if the test
 * only covers the five arms that existed when it was written, so this file asserts totality over the union
 * itself rather than over a hand-listed set.
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { recipeFormMessages } from '../messages.js';
import { resolutionStatusLabel } from '../props.js';

const en = recipeFormMessages.en;

describe('resolutionStatusLabel', () => {
    it('gives every status in the union its own non-empty copy', () => {
        const labels = Object.values(FoodResolutionStatus).map((status) => resolutionStatusLabel(en, status));

        expect(new Set(labels).size).toBe(Object.values(FoodResolutionStatus).length);
        expect(labels.every((label) => label.length > 0)).toBe(true);
    });

    it('labels a gate-contradicted line NEEDS_REVIEW', () => {
        expect(resolutionStatusLabel(en, FoodResolutionStatus.NEEDS_REVIEW)).toBe(en.statusNeedsReview);
    });

    it('⛔ does NOT reuse a food-lifecycle badge for it — the doubt is ours, and it is actionable', () => {
        // `NOT_FOUND`/`FAILED` are terminal facts about the food link, which a cook can only respond to by
        // going freeform. A contradicted line HAS a food and a figure; the cook's move is to re-pick, so the
        // badge must not read like a dead end.
        const label = resolutionStatusLabel(en, FoodResolutionStatus.NEEDS_REVIEW);

        expect(label).not.toBe(en.statusNotFound);
        expect(label).not.toBe(en.statusFailed);
        expect(label).not.toBe(en.statusUnresolved);
    });
});
