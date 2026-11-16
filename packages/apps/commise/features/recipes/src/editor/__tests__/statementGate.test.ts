/**
 * The editor's source question (ADR-0092): the ONE derivation behind both the sheet that opens on Publish and the passive
 * line under the Public card. Exactly one of the two covers a public Publish, so the wire never sends a confirmation the
 * cook did not see and never leaves a public Publish with neither.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { defaultRecipeFormValues } from '../../form/values.js';
import { statementPlanOf } from '../statementGate.js';

const draft = (patch: Partial<ReturnType<typeof defaultRecipeFormValues>> = {}) => ({
    ...defaultRecipeFormValues(),
    visibility: RecipeVisibility.PUBLIC,
    ...patch,
});

describe('statementPlanOf', () => {
    it('shows the passive line and asks nothing for a public draft that was typed', () => {
        expect(statementPlanOf({ draft: draft(), recipe: undefined, answered: false })).toEqual({
            asks: false,
            confirmLineShown: true,
        });
    });

    it('asks, and shows no line, for a public draft that had a paste', () => {
        expect(statementPlanOf({ draft: draft({ pasted: true }), recipe: undefined, answered: false })).toEqual({
            asks: true,
            confirmLineShown: false,
        });
    });

    it('asks for a stored recipe the server says needs a statement', () => {
        const recipe = makeRecipeDetail({ publicNeedsStatement: true });

        expect(statementPlanOf({ draft: draft(), recipe, answered: false }).asks).toBe(true);
    });

    it('does not ask twice, and the answer stands in for the line', () => {
        expect(statementPlanOf({ draft: draft({ pasted: true }), recipe: undefined, answered: true })).toEqual({
            asks: false,
            confirmLineShown: false,
        });
    });

    it('shows neither for a private draft', () => {
        expect(
            statementPlanOf({
                draft: draft({ pasted: true, visibility: RecipeVisibility.PRIVATE }),
                recipe: undefined,
                answered: false,
            }),
        ).toEqual({ asks: false, confirmLineShown: false });
    });

    it('shows neither for a draft that states a web link, which is private whatever was chosen', () => {
        expect(
            statementPlanOf({
                draft: draft({ pasted: true, sourceLink: 'https://example.com/pie' }),
                recipe: undefined,
                answered: false,
            }),
        ).toEqual({ asks: false, confirmLineShown: false });
    });
});
