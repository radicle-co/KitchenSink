/**
 * Whether a collection's visibility change opens the Premium sheet, and whether it can be undone (blueprint Part C,
 * slice 5; plan 2026-10-14-009 D14). Undo is a COMPENSATING `setVisibility`, so it is offered only when the reverse
 * change would be accepted: restoring "private" needs the paid features (`granted`); restoring "public" never does. An
 * Undo the server then refused would be a control that lies.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { canUndoVisibilityChange, visibilityChangeNeedsPremium } from '../visibilityUndo.js';

const { PRIVATE, PUBLIC } = RecipeVisibility;

describe('visibilityChangeNeedsPremium', () => {
    it('opens the sheet only under upsell, making a public collection private', () => {
        expect(visibilityChangeNeedsPremium(PRIVATE, PUBLIC, 'upsell')).toBe(true);

        for (const state of ['granted', 'hidden', 'loading'] as const) {
            expect(visibilityChangeNeedsPremium(PRIVATE, PUBLIC, state), state).toBe(false);
        }
    });

    it('never needs the plan to make a collection public', () => {
        for (const state of ['granted', 'upsell', 'hidden', 'loading'] as const) {
            expect(visibilityChangeNeedsPremium(PUBLIC, PRIVATE, state), state).toBe(false);
        }
    });
});

describe('canUndoVisibilityChange', () => {
    it.each(['granted', 'upsell', 'hidden', 'loading'] as const)(
        'can undo public → private under %s, because the way back (public) is always allowed',
        (state) => {
            expect(canUndoVisibilityChange({ from: PUBLIC, state })).toBe(true);
        },
    );

    it('can undo private → public only under granted', () => {
        expect(canUndoVisibilityChange({ from: PRIVATE, state: 'granted' })).toBe(true);

        for (const state of ['upsell', 'hidden', 'loading'] as const) {
            expect(canUndoVisibilityChange({ from: PRIVATE, state }), state).toBe(false);
        }
    });
});
