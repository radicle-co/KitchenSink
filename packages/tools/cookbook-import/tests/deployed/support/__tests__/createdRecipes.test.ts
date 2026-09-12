/**
 * Every recipe the deployed cookbook import suite creates is deleted by its owner, and the delete is proved by a
 * read that answers `404`.
 *
 * The owner ruling of 2026-09-13 asks the deployed suites to clean up what they write. A delete that answered `204`
 * proves the request; only the owner's read proves the recipe is gone. And a failure is never swallowed: every
 * recipe is attempted, then every failure is reported at once, because the next run's reset-before would otherwise
 * be the first thing to notice.
 */
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { ForbiddenError, NotFoundError, RecipeServiceClientError } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { describe, expect, it, vi } from 'vitest';

import { removeCreatedRecipes, type RecipeRemovalPort } from '../createdRecipes.js';

/** What one fake owner does when asked to delete, then read, a recipe. */
interface Behaviour {
    readonly delete: 'ok' | 'notFound' | 'forbidden';
    readonly read: 'notFound' | 'stillThere' | 'unavailable';
}

/**
 * The house fake client, its two removal calls stubbed to `behaviour`.
 *
 * @param behaviour - What the delete and the read answer.
 * @returns The owner, and its two spies.
 */
function ownerThat(behaviour: Behaviour) {
    const client = createFakeRecipeServiceClient();
    const deleteRecipe = vi.spyOn(client, 'deleteRecipe').mockImplementation(async () => {
        if (behaviour.delete === 'notFound') {
            throw new NotFoundError();
        }

        if (behaviour.delete === 'forbidden') {
            throw new ForbiddenError();
        }
    });
    const getRecipeById = vi.spyOn(client, 'getRecipeById').mockImplementation(async (id) => {
        if (behaviour.read === 'notFound') {
            throw new NotFoundError();
        }

        if (behaviour.read === 'unavailable') {
            throw new RecipeServiceClientError('upstream unavailable', 503);
        }

        return makeRecipeDetail({ id });
    });
    const owner: RecipeRemovalPort = client;

    return { owner, deleteRecipe, getRecipeById };
}

describe('removeCreatedRecipes', () => {
    it('resolves to nothing when the run created nothing', async () => {
        await expect(removeCreatedRecipes([])).resolves.toEqual([]);
    });

    it.each<[string, Behaviour]>([
        ['the delete succeeds and the read answers 404', { delete: 'ok', read: 'notFound' }],
        [
            'the recipe was already gone: the delete and the read both answer 404',
            { delete: 'notFound', read: 'notFound' },
        ],
    ])('removes a recipe when %s', async (_case, behaviour) => {
        const { owner, deleteRecipe, getRecipeById } = ownerThat(behaviour);

        await expect(removeCreatedRecipes([{ id: 'r1', owner }])).resolves.toEqual(['r1']);
        expect(deleteRecipe).toHaveBeenCalledWith('r1');
        expect(getRecipeById).toHaveBeenCalledWith('r1');
    });

    it.each<[string, Behaviour, RegExp]>([
        ['the delete is refused', { delete: 'forbidden', read: 'notFound' }, /r1: the delete failed/u],
        ['the owner can still read it after the delete', { delete: 'ok', read: 'stillThere' }, /r1: still readable/u],
        ['the read cannot confirm the delete', { delete: 'ok', read: 'unavailable' }, /r1: could not confirm/u],
        [
            'a 404 on the delete is contradicted by the read',
            { delete: 'notFound', read: 'stillThere' },
            /r1: still readable/u,
        ],
    ])('fails when %s', async (_case, behaviour, reason) => {
        const { owner } = ownerThat(behaviour);
        const outcome = removeCreatedRecipes([{ id: 'r1', owner }]);

        await expect(outcome).rejects.toBeInstanceOf(AggregateError);
        await expect(outcome).rejects.toSatisfy(
            (error: unknown) =>
                error instanceof AggregateError && error.errors.some((each) => reason.test(String(each))),
        );
    });

    it('attempts every recipe, each as its own owner, then reports every failure at once', async () => {
        const refused = ownerThat({ delete: 'forbidden', read: 'notFound' });
        const lingering = ownerThat({ delete: 'ok', read: 'stillThere' });
        const clean = ownerThat({ delete: 'ok', read: 'notFound' });
        const outcome = removeCreatedRecipes([
            { id: 'r1', owner: refused.owner },
            { id: 'r2', owner: lingering.owner },
            { id: 'r3', owner: clean.owner },
        ]);

        await expect(outcome).rejects.toSatisfy(
            (error: unknown) =>
                error instanceof AggregateError &&
                error.errors.length === 2 &&
                /2 of 3/u.test(error.message) &&
                /r1/u.test(String(error.errors[0])) &&
                /r2/u.test(String(error.errors[1])),
        );
        expect(clean.deleteRecipe).toHaveBeenCalledWith('r3');
        expect(refused.deleteRecipe).not.toHaveBeenCalledWith('r2');
        expect(lingering.deleteRecipe).toHaveBeenCalledWith('r2');
    });

    it('keeps the cause of a failed delete', async () => {
        const { owner } = ownerThat({ delete: 'forbidden', read: 'notFound' });

        await expect(removeCreatedRecipes([{ id: 'r1', owner }])).rejects.toSatisfy(
            (error: unknown) =>
                error instanceof AggregateError &&
                error.errors[0] instanceof Error &&
                error.errors[0].cause instanceof ForbiddenError,
        );
    });
});
