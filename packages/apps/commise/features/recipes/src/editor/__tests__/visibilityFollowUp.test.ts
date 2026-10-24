/**
 * Visibility is its own endpoint (C-004), so after a publish or Save changes the editor sends it only when the cook's
 * choice differs from what the SERVER holds — read from the write's own answer, never from the editor's seed.
 *
 * REWRITTEN for the stuck-save defect: a change TO private that the server is known to refuse (`privateRefusalOf`) is
 * not sent; the editor says why instead. That covers a stale seed (the recipe was made public elsewhere while the editor
 * held Private) and a draft kept from before the cook lost the paid features. A change to Public is never refused.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { visibilityFollowUp } from '../visibilityFollowUp.js';

const { PUBLIC, PRIVATE } = RecipeVisibility;
const holding = (visibility: RecipeVisibility) => makeRecipeDetail({ visibility });

describe('visibilityFollowUp', () => {
    it('asks for the cook`s choice when the server holds the other one and nothing refuses it', () => {
        expect(visibilityFollowUp(PRIVATE, holding(PUBLIC), undefined)).toStrictEqual({
            kind: 'send',
            visibility: PRIVATE,
        });
        expect(visibilityFollowUp(PUBLIC, holding(PRIVATE), undefined)).toStrictEqual({
            kind: 'send',
            visibility: PUBLIC,
        });
    });

    it.each(['final', 'premium'] as const)('⛔ a %s refusal sends no Private, and says so', (refusal) => {
        expect(visibilityFollowUp(PRIVATE, holding(PUBLIC), refusal)).toStrictEqual({ kind: 'refused', refusal });
    });

    it.each(['final', 'premium'] as const)('a %s refusal never stops a change to Public', (refusal) => {
        expect(visibilityFollowUp(PUBLIC, holding(PRIVATE), refusal)).toStrictEqual({
            kind: 'send',
            visibility: PUBLIC,
        });
    });

    it.each([undefined, 'final', 'premium'] as const)(
        'asks for nothing when the server already holds it (%s)',
        (refusal) => {
            expect(visibilityFollowUp(PRIVATE, holding(PRIVATE), refusal)).toStrictEqual({ kind: 'none' });
            expect(visibilityFollowUp(PUBLIC, holding(PUBLIC), refusal)).toStrictEqual({ kind: 'none' });
        },
    );
});
