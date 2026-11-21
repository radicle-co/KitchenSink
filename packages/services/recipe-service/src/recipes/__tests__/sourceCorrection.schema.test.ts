/**
 * The wire of the staff correction (ADR-0099): the five answers WITHOUT a wording, a strict body, a bounded reason, one ground.
 * Each refusal case changes ONE thing from a body that parses, so a schema that stopped refusing it fails exactly that case.
 */
import { describe, expect, it } from 'vitest';

import { SOURCE_CORRECTION_REASON_MAX_LENGTH } from '@kitchensink/recipe-core';

import { sourceCorrectionRequestSchema } from '../recipes.schema.js';

const OK = {
    ownerAccountId: '01JUOWNER000000000000000A1',
    answer: { kind: 'book', citation: 'Joy of Cooking' },
    ground: 'ownerConfirmedByAccountEmail',
    reason: 'Owner asked by email.',
};

describe('sourceCorrectionRequestSchema', () => {
    it.each([
        { kind: 'authored' },
        { kind: 'fromPerson' },
        { kind: 'public_web', citation: 'https://www.allrecipes.com/recipe/1/soup/' },
        { kind: 'book', citation: 'Joy of Cooking' },
        { kind: 'paid_site', citation: 'Sam’s Subscription Kitchen' },
    ])('accepts the answer %j', (answer) => {
        expect(sourceCorrectionRequestSchema.safeParse({ ...OK, answer }).success).toBe(true);
    });

    it.each([
        [
            'an answer with a wording',
            { ...OK, answer: { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } },
        ],
        ['"I wrote this" with a citation', { ...OK, answer: { kind: 'authored', citation: 'x' } }],
        ['a book with no citation', { ...OK, answer: { kind: 'book' } }],
        [
            'a web link that is not a usable source',
            { ...OK, answer: { kind: 'public_web', citation: 'http://localhost/r' } },
        ],
        ['an unknown answer kind', { ...OK, answer: { kind: 'curator' } }],
        ['an unknown top-level field', { ...OK, visibility: 'public' }],
        ['no owner', { ...OK, ownerAccountId: undefined }],
        ['an empty owner', { ...OK, ownerAccountId: '' }],
        ['a ground that is not in the list', { ...OK, ground: 'because' }],
        ['a blank reason', { ...OK, reason: '   ' }],
        ['a reason over the bound', { ...OK, reason: 'x'.repeat(SOURCE_CORRECTION_REASON_MAX_LENGTH + 1) }],
    ])('refuses %s', (_name, body) => {
        expect(sourceCorrectionRequestSchema.safeParse(body).success).toBe(false);
    });

    it('accepts a reason exactly at the bound', () => {
        expect(
            sourceCorrectionRequestSchema.safeParse({ ...OK, reason: 'x'.repeat(SOURCE_CORRECTION_REASON_MAX_LENGTH) })
                .success,
        ).toBe(true);
    });
});
