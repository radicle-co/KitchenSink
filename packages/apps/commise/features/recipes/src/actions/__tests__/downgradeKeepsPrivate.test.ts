/**
 * ⛔ A DOWNGRADE NEVER MAKES A PRIVATE RECIPE PUBLIC (owner ruling 2026-10-26; ADR-0073 section 4). A cook who lost Premium
 * keeps every private recipe, even past the limit, and no client path may turn one public by itself: not the rule, the
 * editor's write, the follow-up after a publish, nor the visibility the editor sends for an existing recipe.
 *
 * Every case here holds a private recipe at 60 of 50 (over the limit, so the standing is `full`) under each refusal the
 * client can know, and asserts the recipe is still private. The only path that makes a private recipe public is the cook
 * choosing Public and confirming it, which is asserted as the contrast. (The server's half of this ruling is the LOCAL e2e
 * `privateSlots.e2e.test.ts`, "a downgrade never publishes".)
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeRecipeDetail, makeRecipeFormValues } from '../../__fixtures__/index.js';
import { recipeWriteIntent } from '../../editor/editorIntents.js';
import { seedEditorCore } from '../../editor/editorCore.js';
import { visibilityFollowUp } from '../../editor/visibilityFollowUp.js';
import { toRecipeFormValues } from '../../form/wire.js';
import type { RecipeFormValues } from '../../form/values.js';
import { effectiveVisibility, heldVisibility, PRIVATE_REFUSALS, type PrivateRefusal } from '../privateGate.js';
import {
    recipePrivateChoice,
    recipePrivateRefusalOf,
    type PrivateRule,
    type RecipePrivateFacts,
} from '../recipePrivateGate.js';
import { usePrivateChoice } from '../usePrivateChoice.js';

const PRIVATE = RecipeVisibility.PRIVATE;
const PUBLIC = RecipeVisibility.PUBLIC;
const OVER = { kind: 'full', used: 60, limit: 50 } as const;
const RULES: readonly PrivateRule[] = ['slots', 'privateOnly', 'premium'];
const REFUSALS: readonly (PrivateRefusal | undefined)[] = [undefined, ...PRIVATE_REFUSALS];

describe('a downgrade never makes a private recipe public - the pure rules', () => {
    it.each(REFUSALS)('keeps a held Private in the draft under the refusal %s', (refusal) => {
        expect(effectiveVisibility(refusal, PRIVATE, PRIVATE)).toBe(PRIVATE);
    });

    it.each(RULES)(
        'keeps asking for Private on a recipe that is already private an apply, under the %s rule',
        (rule) => {
            for (const state of ['granted', 'upsell', 'hidden', 'loading'] as const) {
                const facts: RecipePrivateFacts = { rule, standing: OVER, state };

                expect(recipePrivateChoice(facts, PRIVATE, PRIVATE)).toBe('apply');
            }
        },
    );

    it.each(REFUSALS)(
        'sends nothing after a write of a private recipe the cook left private (refusal %s)',
        (refusal) => {
            expect(visibilityFollowUp(PRIVATE, makeRecipeDetail({ visibility: PRIVATE }), refusal)).toStrictEqual({
                kind: 'none',
            });
        },
    );

    it.each(REFUSALS)('an UPDATE of a stored recipe carries no visibility at all (refusal %s)', (refusal) => {
        const stored = makeRecipeDetail({ id: 'rec_1', visibility: PRIVATE });
        const intent = recipeWriteIntent({
            server: seedEditorCore({ recipe: stored }).core.server,
            draft: toRecipeFormValues(stored),
            ref: 'local:recipe:x',
            publish: true,
            privateRefusal: refusal,
        });

        expect(intent.intentKind).toBe('update');
        expect(JSON.stringify(intent.payload)).not.toContain('visibility');
    });

    it('a hold is lost only when the DRAFT moves off Private, never because the standing is over the limit', () => {
        expect(heldVisibility(PRIVATE, PRIVATE)).toBe(PRIVATE);
        expect(heldVisibility(PRIVATE, PUBLIC)).toBe(PUBLIC);
    });
});

describe('a downgrade never makes a private recipe public - the editor over the limit', () => {
    const mountEditor = (rule: PrivateRule, values: RecipeFormValues) => {
        const onChange = vi.fn<(next: RecipeFormValues) => void>();
        const view = renderHook(() =>
            usePrivateChoice({
                state: 'upsell',
                knownPaidFeatures: 'upsell',
                rule,
                standing: OVER,
                publication: { published: true },
                saved: PRIVATE,
                values,
                onChange,
            }),
        );

        return { ...view, onChange };
    };

    const PRIVATE_DRAFT = makeRecipeFormValues({ visibility: PRIVATE });

    it.each(['slots', 'privateOnly'] as const)(
        'opening a private recipe (%s rule) at 60 of 50 changes nothing and keeps it Private',
        (rule) => {
            const { result, onChange } = mountEditor(rule, PRIVATE_DRAFT);

            expect(onChange).not.toHaveBeenCalled();
            expect(result.current.field.heldVisibility).toBe(PRIVATE);
            expect(result.current.field.facts.standing).toStrictEqual(OVER);
            // The statement ("Public") is for a Private that will NOT stand; here it stands.
            expect(result.current.offersPrivate).toBe(true);
            expect(result.current.statement.privateUnavailable).toBe(false);
        },
    );

    it('a recipe still held Private is not refused: the known refusal is for a CHANGE to private only', () => {
        const refusal = recipePrivateRefusalOf({ rule: 'slots', standing: OVER, state: 'upsell' });

        expect(refusal).toBe('slots');
        expect(effectiveVisibility(refusal, heldVisibility(PRIVATE, PRIVATE), PRIVATE)).toBe(PRIVATE);
    });

    it('contrast: the one way it goes public is the cook choosing Public and confirming it', () => {
        const { result, onChange } = mountEditor('slots', PRIVATE_DRAFT);

        act(() => result.current.onConfirmPublic());
        expect(result.current.confirm.open).toBe(true);
        expect(onChange).not.toHaveBeenCalled();

        act(() => result.current.confirm.onConfirm());
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: PUBLIC }));
    });
});
