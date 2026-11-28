import { describe, expect, it } from 'vitest';

import type { ProviderDouble } from '@kitchensink/service-test-harness';

import { DEFAULT_ANSWERS, withDefaultDoubles } from '../../tests/support/mockedRecipeApp.js';
import { ErasureJobsDal } from '../account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../authors/dal/authorHandles.dal.js';
import { RECIPE_LINE_VERIFICATIONS_DAL, RECIPE_PHOTOS_DAL, RECIPE_RATINGS_DAL } from '../recipes/recipes.tokens.js';
import { RecipeStatementAttestationsDal } from '../recipes/dal/recipeStatementAttestations.dal.js';
import { PendingArchivesDal } from '../versions/dal/pendingArchives.dal.js';

/** The token each default answers for, beside the default's own value. */
const DEFAULTED: ReadonlyArray<readonly [string, ProviderDouble['provide'], unknown]> = [
    ['RecipeStatementAttestationsDal', RecipeStatementAttestationsDal, DEFAULT_ANSWERS.attestations],
    ['PendingArchivesDal', PendingArchivesDal, DEFAULT_ANSWERS.pendingArchives],
    ['RECIPE_PHOTOS_DAL', RECIPE_PHOTOS_DAL, DEFAULT_ANSWERS.photos],
    ['RECIPE_RATINGS_DAL', RECIPE_RATINGS_DAL, DEFAULT_ANSWERS.ratings],
    ['RECIPE_LINE_VERIFICATIONS_DAL', RECIPE_LINE_VERIFICATIONS_DAL, DEFAULT_ANSWERS.lineVerifications],
    ['ErasureJobsDal', ErasureJobsDal, DEFAULT_ANSWERS.erasureJobs],
    ['AuthorHandlesDal', AuthorHandlesDal, DEFAULT_ANSWERS.authorHandles],
];

/** `bootServiceApp` applies doubles in order and the LAST one for a token wins, so that is the one a suite gets. */
function effective(doubles: readonly ProviderDouble[], token: ProviderDouble['provide']): unknown {
    return doubles.filter((double) => double.provide === token).at(-1)?.useValue;
}

describe('withDefaultDoubles', () => {
    it.each(DEFAULTED)('gives every suite a default for %s', (_name, token, value) => {
        expect(effective(withDefaultDoubles([]), token)).toBe(value);
    });

    it.each(DEFAULTED)('lets a suite double for %s replace the whole default', (_name, token) => {
        const own: ProviderDouble = { provide: token, useValue: { own: true } };

        expect(effective(withDefaultDoubles([own]), token)).toBe(own.useValue);
    });

    it('keeps the suite doubles for tokens it does not default', () => {
        const own: ProviderDouble = { provide: 'SOMETHING_ELSE', useValue: {} };

        expect(effective(withDefaultDoubles([own]), 'SOMETHING_ELSE')).toBe(own.useValue);
    });
});

describe('DEFAULT_ANSWERS', () => {
    it('answers "nothing" to every read, and accepts the one write and reports no rows inserted', async () => {
        await expect(DEFAULT_ANSWERS.attestations.insertMany()).resolves.toBeUndefined();
        await expect(DEFAULT_ANSWERS.attestations.hasFromPerson()).resolves.toBe(false);
        await expect(DEFAULT_ANSWERS.attestations.hasWordedAttestation()).resolves.toBe(false);
        await expect(DEFAULT_ANSWERS.photos.findByRecipe()).resolves.toEqual([]);
        await expect(DEFAULT_ANSWERS.ratings.findStars()).resolves.toBeUndefined();
        await expect(DEFAULT_ANSWERS.lineVerifications.findBandsByKeys()).resolves.toEqual(new Map());
        await expect(DEFAULT_ANSWERS.lineVerifications.findExistingKeys()).resolves.toEqual(new Set());
        await expect(DEFAULT_ANSWERS.erasureJobs.findActiveJob()).resolves.toBeUndefined();
        await expect(DEFAULT_ANSWERS.authorHandles.findByline()).resolves.toBeUndefined();
        await expect(DEFAULT_ANSWERS.pendingArchives.enqueueMany()).resolves.toEqual([]);
    });
});
