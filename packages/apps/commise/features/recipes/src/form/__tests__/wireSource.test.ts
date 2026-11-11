/**
 * The Source on the wire and in the seed (ADR-0089): the create carries a `statement`, an update carries only a change, and
 * a stored web source seeds the field. The bodies are parsed through the published request schemas, so a body the server
 * would refuse fails here.
 */
import { RecipeSourceType, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { createRecipeRequestSchema, updateRecipeRequestSchema } from '@kitchensink/schema-recipe';
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues, makeRecipeDetail } from '../../__fixtures__/index.js';
import { applyDraftAction } from '../props.js';
import { recipeFormValuesEqual } from '../values.js';
import { toCreateRecipeInput, toRecipeFormValues, toUpdateRecipeInput } from '../wire.js';

const ALLRECIPES = 'https://www.allrecipes.com/recipe/1/soup/';
const webCopy = (over = {}) =>
    makeRecipeDetail({
        sourceType: RecipeSourceType.IMPORTED_PUBLIC,
        sourceKind: 'public_web',
        sourceUrl: ALLRECIPES,
        visibility: RecipeVisibility.PRIVATE,
        status: RecipeStatus.DRAFT,
        ...over,
    });

describe('toCreateRecipeInput carries the Source', () => {
    it('sends the link as a public_web statement, and the body is one the server accepts', () => {
        const body = toCreateRecipeInput(makeFilledRecipeFormValues({ sourceLink: ` ${ALLRECIPES}. ` }));

        expect(body.statement).toEqual({ kind: 'public_web', citation: ALLRECIPES });
        expect(createRecipeRequestSchema.safeParse(body).success).toBe(true);
    });

    it('sends no statement for no link, or for text that is not a link', () => {
        expect(toCreateRecipeInput(makeFilledRecipeFormValues())).not.toHaveProperty('statement');
        expect(toCreateRecipeInput(makeFilledRecipeFormValues({ sourceLink: 'soup' }))).not.toHaveProperty('statement');
    });

    it('never sends the curator `source`', () => {
        expect(toCreateRecipeInput(makeFilledRecipeFormValues({ sourceLink: ALLRECIPES }))).not.toHaveProperty(
            'source',
        );
    });
});

describe('toUpdateRecipeInput carries only a change of Source', () => {
    const update = (values = makeFilledRecipeFormValues(), recipe = makeRecipeDetail({ status: RecipeStatus.DRAFT })) =>
        toUpdateRecipeInput(values, undefined, recipe);

    it('sends a new link on a never-published recipe, and the body is one the server accepts', () => {
        const body = update(makeFilledRecipeFormValues({ sourceLink: ALLRECIPES }));

        expect(body.statement).toEqual({ kind: 'public_web', citation: ALLRECIPES });
        expect(updateRecipeRequestSchema.safeParse({ ...body, expectedVersion: 1 }).success).toBe(true);
    });

    it('sends nothing when the server already holds that source', () => {
        expect(update(makeFilledRecipeFormValues({ sourceLink: ALLRECIPES }), webCopy())).not.toHaveProperty(
            'statement',
        );
    });

    it('sends null when the cook removed a stored web source', () => {
        expect(update(makeFilledRecipeFormValues(), webCopy())).toHaveProperty('statement', null);
    });

    it('sends nothing when there is no source and none is stored', () => {
        expect(update()).not.toHaveProperty('statement');
    });

    it('sends nothing once the recipe has been published', () => {
        const published = webCopy({ status: RecipeStatus.PUBLISHED });

        expect(update(makeFilledRecipeFormValues(), published)).not.toHaveProperty('statement');
    });

    it('sends nothing for half-typed text', () => {
        expect(update(makeFilledRecipeFormValues({ sourceLink: 'https://' }), webCopy())).not.toHaveProperty(
            'statement',
        );
    });
});

describe('toRecipeFormValues seeds the Source', () => {
    it('seeds a stored web source as the field’s text', () => {
        expect(toRecipeFormValues(webCopy()).sourceLink).toBe(ALLRECIPES);
    });

    it('leaves the field absent for a recipe with no web source (the curator’s text, a book, none)', () => {
        expect(toRecipeFormValues(makeRecipeDetail())).not.toHaveProperty('sourceLink');
        expect(
            toRecipeFormValues(
                makeRecipeDetail({
                    sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                    sourceUrl: 'https://archive.org/details/cookbook',
                }),
            ),
        ).not.toHaveProperty('sourceLink');
    });

    it('opened and left alone, the draft equals what the server holds', () => {
        const seeded = toRecipeFormValues(webCopy());

        expect(recipeFormValuesEqual(seeded, toRecipeFormValues(webCopy()))).toBe(true);
    });
});

describe('the setSourceLink transition', () => {
    const base = makeFilledRecipeFormValues();

    it('sets the text, and REMOVES the key when it is emptied (a draft with none equals one that never had one)', () => {
        const set = applyDraftAction(base, { kind: 'setSourceLink', link: ALLRECIPES });

        expect(set.sourceLink).toBe(ALLRECIPES);
        expect(recipeFormValuesEqual(applyDraftAction(set, { kind: 'setSourceLink', link: '' }), base)).toBe(true);
        expect(applyDraftAction(set, { kind: 'setSourceLink', link: '' })).not.toHaveProperty('sourceLink');
    });

    it('keeps the key last, so a seeded draft and an edited one serialise alike', () => {
        const edited = applyDraftAction(base, { kind: 'setSourceLink', link: ALLRECIPES });

        expect(Object.keys(edited).at(-1)).toBe('sourceLink');
        expect(Object.keys(toRecipeFormValues(webCopy())).at(-1)).toBe('sourceLink');
    });
});
