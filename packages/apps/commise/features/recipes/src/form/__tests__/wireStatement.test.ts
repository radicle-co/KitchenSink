/**
 * What the source-statement sheet puts on the wire (ADR-0095): the cook's answer, the paste fact and the Public confirmation.
 * The bodies are parsed through the published request schemas, so a body the server would refuse fails here.
 *
 * The rows a mutant must not survive:
 *  1. `contentPasted` rides only when the draft was pasted into, and its key is ABSENT otherwise (never `false`).
 *  2. A sheet statement beats the Source field's own, and is sent for a recipe whose source is locked (published once): the
 *     sheet's first statement is the one move the lock lets through.
 *  3. A wording is sent only when a screen showed it. "I wrote this" rides only the write that publishes; the draft
 *     checkpoints before it never carry it, because a server that already holds it would then owe the confirmation again.
 */
import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { createRecipeRequestSchema, updateRecipeRequestSchema } from '@kitchensink/schema-recipe';
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues, makeRecipeDetail } from '../../__fixtures__/index.js';
import { toCreateRecipeInput, toUpdateRecipeInput } from '../wire.js';

const AUTHORED = { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } as const;
const BOOK = {
    kind: 'book',
    citation: 'Joy of Cooking',
    wording: { version: 'statementBook.v1', locale: 'en' },
} as const;
const CONFIRM = { version: 'publicConfirm.v1', locale: 'en' } as const;
const ALLRECIPES = 'https://www.allrecipes.com/recipe/1/soup/';
const PUBLIC = makeFilledRecipeFormValues({ visibility: RecipeVisibility.PUBLIC });
const PUBLISHED = RecipeStatus.PUBLISHED;
const stored = (over = {}) =>
    makeRecipeDetail({ status: RecipeStatus.DRAFT, visibility: RecipeVisibility.PRIVATE, ...over });

describe('contentPasted', () => {
    it('is sent as true when the draft was pasted into', () => {
        const values = { ...PUBLIC, pasted: true as const };

        expect(toCreateRecipeInput(values, PUBLISHED)).toMatchObject({ contentPasted: true });
        expect(toUpdateRecipeInput(values, PUBLISHED, stored())).toMatchObject({ contentPasted: true });
    });

    it('has no key when the draft was not pasted into', () => {
        expect(toCreateRecipeInput(PUBLIC, PUBLISHED)).not.toHaveProperty('contentPasted');
        expect(toUpdateRecipeInput(PUBLIC, PUBLISHED, stored())).not.toHaveProperty('contentPasted');
    });

    it('is a body the server accepts', () => {
        const values = { ...PUBLIC, pasted: true as const };

        expect(createRecipeRequestSchema.safeParse(toCreateRecipeInput(values, PUBLISHED)).success).toBe(true);
        expect(
            updateRecipeRequestSchema.safeParse({
                ...toUpdateRecipeInput(values, PUBLISHED, stored()),
                expectedVersion: 1,
            }).success,
        ).toBe(true);
    });
});

describe('a sheet statement', () => {
    it('is sent on the create that publishes, with no separate confirmation for "I wrote this"', () => {
        const body = toCreateRecipeInput(PUBLIC, PUBLISHED, { statement: AUTHORED });

        expect(body.statement).toEqual(AUTHORED);
        expect(body).not.toHaveProperty('publicConfirmation');
        expect(createRecipeRequestSchema.safeParse(body).success).toBe(true);
    });

    it('beats the Source field’s own statement', () => {
        const values = { ...PUBLIC, sourceLink: ALLRECIPES };

        expect(toCreateRecipeInput(values, PUBLISHED, { statement: BOOK }).statement).toEqual(BOOK);
        expect(toUpdateRecipeInput(values, PUBLISHED, stored(), { statement: BOOK }).statement).toEqual(BOOK);
    });

    it('is sent for a PUBLISHED-once recipe whose Source row is locked: the first statement is the one move the lock allows', () => {
        const published = stored({ firstPublishedAt: '2026-11-01T00:00:00.000Z', status: RecipeStatus.PUBLISHED });

        expect(toUpdateRecipeInput(PUBLIC, PUBLISHED, published, { statement: BOOK }).statement).toEqual(BOOK);
        expect(toUpdateRecipeInput(PUBLIC, PUBLISHED, published)).not.toHaveProperty('statement');
    });

    it('"I wrote this" rides only a write that publishes: a draft checkpoint never carries it', () => {
        expect(toCreateRecipeInput(PUBLIC, RecipeStatus.DRAFT, { statement: AUTHORED })).not.toHaveProperty(
            'statement',
        );
        expect(toCreateRecipeInput(PUBLIC, undefined, { statement: AUTHORED })).not.toHaveProperty('statement');
        expect(toUpdateRecipeInput(PUBLIC, undefined, stored(), { statement: AUTHORED })).not.toHaveProperty(
            'statement',
        );
    });

    it('a third-party statement rides only a write that publishes too, so it is stated and recorded once', () => {
        expect(toUpdateRecipeInput(PUBLIC, undefined, stored(), { statement: BOOK })).not.toHaveProperty('statement');
    });
});

describe('the Public confirmation', () => {
    it('is sent with a publish to Public only when a screen gave the line it showed', () => {
        expect(toCreateRecipeInput(PUBLIC, PUBLISHED, { publicConfirmation: CONFIRM })).toMatchObject({
            publicConfirmation: CONFIRM,
        });
        expect(toCreateRecipeInput(PUBLIC, PUBLISHED)).not.toHaveProperty('publicConfirmation');
    });

    it('is not sent for a Private result or for a draft', () => {
        const priv = makeFilledRecipeFormValues({ visibility: RecipeVisibility.PRIVATE });

        expect(toCreateRecipeInput(priv, PUBLISHED, { publicConfirmation: CONFIRM })).not.toHaveProperty(
            'publicConfirmation',
        );
        expect(toCreateRecipeInput(PUBLIC, RecipeStatus.DRAFT, { publicConfirmation: CONFIRM })).not.toHaveProperty(
            'publicConfirmation',
        );
    });
});
