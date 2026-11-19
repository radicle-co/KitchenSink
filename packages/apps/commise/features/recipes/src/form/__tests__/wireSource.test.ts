/**
 * The Source on the wire and in the seed (ADR-0089): the create carries a `statement`, an update carries only a change, and
 * a stored web source seeds the field. The bodies are parsed through the published request schemas, so a body the server
 * would refuse fails here.
 *
 * The statement wording is the caller's input (the screen that shows the line): the builders send none of their own. The
 * tests that asserted a built-in English wording are rewritten to prove that.
 */
import { RecipeSourceType, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { createRecipeRequestSchema, updateRecipeRequestSchema } from '@kitchensink/schema-recipe';
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues, makeRecipeDetail } from '../../__fixtures__/index.js';
import { applyDraftAction } from '../props.js';
import { recipeFormValuesEqual } from '../values.js';
import { toCreateRecipeInput, toRecipeFormValues, toUpdateRecipeInput } from '../wire.js';

const WORDING = { version: 'statementPublicWeb.v1', locale: 'fr' } as const;
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
    it('sends the link with the wording the caller gives, and the body is one the server accepts', () => {
        const body = toCreateRecipeInput(makeFilledRecipeFormValues({ sourceLink: ` ${ALLRECIPES}. ` }), undefined, {
            statementWording: WORDING,
        });

        expect(body.statement).toEqual({ kind: 'public_web', citation: ALLRECIPES, wording: WORDING });
        expect(createRecipeRequestSchema.safeParse(body).success).toBe(true);
    });

    it('sends the link with NO wording when the caller gives none, and never one of its own', () => {
        const body = toCreateRecipeInput(makeFilledRecipeFormValues({ sourceLink: ALLRECIPES }));

        expect(body.statement).toEqual({ kind: 'public_web', citation: ALLRECIPES });
        // Rewritten for the Source row: the contract takes a web statement without a wording (no attestation is recorded),
        // so the row's own body is valid as it stands.
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

    it('sends a new link on a never-published recipe with the caller wording, and the body is one the server accepts', () => {
        const body = toUpdateRecipeInput(
            makeFilledRecipeFormValues({ sourceLink: ALLRECIPES }),
            undefined,
            makeRecipeDetail({ status: RecipeStatus.DRAFT }),
            { statementWording: WORDING },
        );

        expect(body.statement).toEqual({ kind: 'public_web', citation: ALLRECIPES, wording: WORDING });
        expect(updateRecipeRequestSchema.safeParse({ ...body, expectedVersion: 1 }).success).toBe(true);
    });

    it('sends a new link with no wording when the caller gives none', () => {
        expect(update(makeFilledRecipeFormValues({ sourceLink: ALLRECIPES })).statement).toEqual({
            kind: 'public_web',
            citation: ALLRECIPES,
        });
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

    // Rewritten by the 2026-11-15 owner ruling: it said a published recipe sends nothing. The first publish does not lock the
    // statement, so a published recipe sends the cook's change; a locked source (a clone's) still sends nothing.
    it('sends the change once the recipe has been published', () => {
        const published = webCopy({ status: RecipeStatus.PUBLISHED, firstPublishedAt: '2026-11-01T00:00:00.000Z' });

        expect(update(makeFilledRecipeFormValues(), published)).toHaveProperty('statement', null);
    });

    it('sends nothing for a published recipe whose source a clone inherited', () => {
        const inherited = webCopy({
            status: RecipeStatus.PUBLISHED,
            firstPublishedAt: '2026-11-01T00:00:00.000Z',
            clonedFromId: '00000000-0000-4000-8000-0000000000c1',
        });

        expect(update(makeFilledRecipeFormValues(), inherited)).not.toHaveProperty('statement');
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
