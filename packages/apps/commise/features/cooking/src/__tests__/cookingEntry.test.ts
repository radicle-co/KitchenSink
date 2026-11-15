import { RecipeStatus } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { cookingEntryOf } from '../cookingEntry.js';
import type { CookingScreenRead } from '../cookingViewProps.js';

const retry = (): void => undefined;

/** A ready read; the steps are `{ stepNumber, instruction }` rows as the recipe carries them. */
const ready = (
    overrides: { status?: RecipeStatus; viewerIsOwner?: boolean; steps?: readonly string[] } = {},
): CookingScreenRead => ({
    kind: 'ready',
    viewerIsOwner: overrides.viewerIsOwner ?? false,
    recipe: {
        id: 'r1',
        title: 'Soup',
        status: overrides.status ?? RecipeStatus.PUBLISHED,
        steps: (overrides.steps ?? ['Chop the onion', 'Simmer']).map((instruction, index) => ({
            stepNumber: index + 1,
            instruction,
        })),
    },
});

/** The entry decision for a read that has not become a recipe yet, or never will, and for a recipe that has. */
describe('cookingEntryOf', () => {
    it('is loading, not redirecting, while the read is pending', () => {
        expect(cookingEntryOf({ kind: 'pending', retry })).toEqual({ state: { kind: 'loading' }, redirecting: false });
    });

    it('names a failed read, online and offline', () => {
        expect(cookingEntryOf({ kind: 'failed', offline: false, retry }).state).toEqual({
            kind: 'error',
            offline: false,
        });
        expect(cookingEntryOf({ kind: 'failed', offline: true, retry }).state).toEqual({
            kind: 'error',
            offline: true,
        });
    });

    it('is gone for a recipe that cannot be read', () => {
        expect(cookingEntryOf({ kind: 'gone' }).state).toEqual({ kind: 'gone' });
    });

    it('cooks a published recipe that has steps', () => {
        expect(cookingEntryOf(ready())).toEqual({ state: { kind: 'ready' }, redirecting: false });
    });

    it('counts only steps with text: blank steps leave no steps to cook', () => {
        expect(cookingEntryOf(ready({ steps: ['  ', ''] })).state).toEqual({ kind: 'noSteps' });
    });

    it('sends an owner of a draft to the editor, showing the loading frame meanwhile', () => {
        expect(cookingEntryOf(ready({ status: RecipeStatus.DRAFT, viewerIsOwner: true }))).toEqual({
            state: { kind: 'loading' },
            redirecting: true,
        });
    });

    it('never tells a non-owner that a recipe is a draft: it is gone', () => {
        expect(cookingEntryOf(ready({ status: RecipeStatus.DRAFT, viewerIsOwner: false }))).toEqual({
            state: { kind: 'gone' },
            redirecting: false,
        });
    });
});
