import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { chipOf } from '../chipOf.js';

/**
 * The one chip rule (hiddenViews KTD-5, AE5): Draft > Hidden > Public | Private. A literal table, so a reordered
 * precedence or a Hidden that shows for a private audience goes red.
 */
describe('chipOf', () => {
    const { PUBLISHED, DRAFT } = RecipeStatus;
    const { PUBLIC, PRIVATE } = RecipeVisibility;

    it.each([
        // A draft is a draft, whatever the audience and whatever the owner is told.
        [DRAFT, PUBLIC, undefined, 'draft'],
        [DRAFT, PUBLIC, 'heldSource', 'draft'],
        [DRAFT, PRIVATE, 'sourceCorrected', 'draft'],
        [DRAFT, PRIVATE, undefined, 'draft'],
        // A published public recipe the owner is told is hidden: Hidden, for a known reason, `other` or one this app does not know.
        [PUBLISHED, PUBLIC, 'sourceCorrected', 'hidden'],
        [PUBLISHED, PUBLIC, 'heldSource', 'hidden'],
        [PUBLISHED, PUBLIC, 'other', 'hidden'],
        [PUBLISHED, PUBLIC, 'aReasonFromANewerServer', 'hidden'],
        [PUBLISHED, PUBLIC, '', 'hidden'],
        // Make private wins over a stale reason: nothing holds a private recipe from its readers.
        [PUBLISHED, PRIVATE, 'heldSource', 'private'],
        [PUBLISHED, PRIVATE, undefined, 'private'],
        // No reason: the audience says it.
        [PUBLISHED, PUBLIC, undefined, 'public'],
    ] as const)('%s, %s, reason %j gives %s', (status, visibility, hiddenReason, expected) => {
        expect(chipOf({ status, visibility, hiddenReason })).toBe(expected);
    });

    it('reads an absent reason the same as an undefined one', () => {
        expect(chipOf({ status: PUBLISHED, visibility: PUBLIC })).toBe('public');
    });
});
