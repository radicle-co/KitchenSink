/**
 * {@link neverPublished} — what guided first-recipe progress keys on (build spec §7.2; owner decision D1): the account
 * has never published a recipe. "Has no recipes" is the wrong question, and `status` the wrong evidence: a published
 * recipe set back to a draft keeps `firstPublishedAt` (ADR-0058 rule 1).
 */
import { RecipeStatus } from '@kitchensink/recipe-core';
import type { LibraryChunk } from '@kitchensink/recipe-service-client';
import { describe, expect, it } from 'vitest';

import { makeRecipe } from '../../__fixtures__/index.js';
import { neverPublished } from '../guidedProgress.js';

const chunk = (data: LibraryChunk['data'], hasMore = false): LibraryChunk => ({
    data,
    total: data.length,
    hasMore,
    nextFirstPage: 6,
});
const draft = () => makeRecipe({ status: RecipeStatus.DRAFT, firstPublishedAt: undefined });

describe('neverPublished', () => {
    it('is true for an empty library', () => {
        expect(neverPublished(chunk([]))).toBe(true);
    });

    it('is true when every recipe is a draft that was never published', () => {
        expect(neverPublished(chunk([draft(), draft()]))).toBe(true);
    });

    it('is false when a recipe is published', () => {
        const published = makeRecipe({ status: RecipeStatus.PUBLISHED, firstPublishedAt: '2026-10-01T10:00:00.000Z' });

        expect(neverPublished(chunk([draft(), published]))).toBe(false);
    });

    it('is false for a recipe published once and set back to a draft', () => {
        const reverted = makeRecipe({ status: RecipeStatus.DRAFT, firstPublishedAt: '2026-10-01T10:00:00.000Z' });

        expect(neverPublished(chunk([reverted]))).toBe(false);
    });

    it('is false when status says published even if the first-published fact is absent', () => {
        expect(
            neverPublished(chunk([makeRecipe({ status: RecipeStatus.PUBLISHED, firstPublishedAt: undefined })])),
        ).toBe(false);
    });

    it('⛔ is false when more recipes lie past the first chunk and none in it is published: it cannot be known', () => {
        expect(neverPublished(chunk([draft()], true))).toBe(false);
    });
});
