/**
 * Whether a visibility change can be undone (blueprint Part C, slice 5): undo is a COMPENSATING `setVisibility`, so it
 * is offered only when the reverse change would be accepted. Restoring "private" needs the premium plan; restoring
 * "public" never does. An Undo that the server then refused would be a control that lies.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { canUndoVisibilityChange, visibilityChangeNeedsPremium } from '../visibilityUndo.js';

const { PRIVATE, PUBLIC } = RecipeVisibility;

describe('visibilityChangeNeedsPremium', () => {
    it('needs the plan to make a collection private, and only for a viewer without it', () => {
        expect(visibilityChangeNeedsPremium(PRIVATE, false)).toBe(true);
        expect(visibilityChangeNeedsPremium(PRIVATE, true)).toBe(false);
    });

    it('never needs the plan to make a collection public', () => {
        expect(visibilityChangeNeedsPremium(PUBLIC, false)).toBe(false);
        expect(visibilityChangeNeedsPremium(PUBLIC, true)).toBe(false);
    });
});

describe('canUndoVisibilityChange', () => {
    it('can undo public → private, because the way back (public) is always allowed', () => {
        expect(canUndoVisibilityChange({ from: PUBLIC, canGoPrivate: true })).toBe(true);
    });

    it('can undo private → public for a viewer who may go private', () => {
        expect(canUndoVisibilityChange({ from: PRIVATE, canGoPrivate: true })).toBe(true);
    });

    it('cannot undo private → public for a viewer who may not go private: the reverse would be refused', () => {
        expect(canUndoVisibilityChange({ from: PRIVATE, canGoPrivate: false })).toBe(false);
    });
});
