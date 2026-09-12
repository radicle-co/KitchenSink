/**
 * DEPLOYED e2e (`docs/CODING_STANDARDS.md` §7.1a): the curated cookbook import, against one `pr-{N}` preview's real
 * recipe and food services, signed in as the test pool's curator.
 *
 * ## What only a deployment can prove
 *
 * The unit and integration tiers exhaust the parser and the resolution ladder against fakes, and a fake agrees with
 * whatever this tool believes about the API. Four claims need the real thing:
 *
 *  1. **A recipe parsed out of 1900s prose is ACCEPTED by the shipped contract**: the servings, the three times,
 *     the `numeric(10,3)` quantities and the `strictObject` bodies all hold against the real pipe.
 *  2. **Declared provenance survives to the read model**: `sourceType`, `sourceUrl` and `sourceAttribution` come
 *     back on the recipe the API returns (004-FR-024 / ADR-0023).
 *  3. **The curator GRANT is what admits it**: the same body from a token without `recipes:import:public` is
 *     refused `403`. It needs a second, ungranted bearer in `COOKBOOK_IMPORT_UNGRANTED_TOKEN`. The linkage job leases
 *     one pool lane, which carries the grant, so in CI this case is reported SKIPPED.
 *  4. **The ingredient names go through the product's catalog lookup**, and at least one reaches a real `food_id`.
 *
 * ## Target and credential
 *
 * `deployedE2eTiers.yml`'s `e2e-cross-service-linkage` job names the preview's origins, mints the curator credential
 * from the pool's linkage lane (`packages/tools/e2e-fixtures/src/testPool.ts`) immediately before this runs, and
 * resets that lane before and after. With no target named the suite SKIPS. ⛔ A skip is never a pass: it proves
 * nothing about the import, and no report may count it as run. A job that declares `E2E_TARGET=deployed` and names no
 * target fails instead (`support/deployedImportTarget.ts`). The grant is read from the token, not the file
 * (`support/curatorCredential.ts`).
 *
 * ## Cleanup
 *
 * Every recipe it creates is deleted in `afterAll` by its owner and read back as `404` (`support/createdRecipes.ts`).
 * A cleanup failure fails the run. The ingredient bindings the lookup writes, and a recipe whose create response was
 * lost, are left to the job's reset-after.
 *
 * ## Running it by hand
 *
 * ```bash
 * export COOKBOOK_IMPORT_RECIPE_URL=https://recipe-pr-{N}.commise.app
 * export COOKBOOK_IMPORT_FOOD_URL=https://food-pr-{N}.commise.app
 * export COOKBOOK_IMPORT_CREDENTIALS=/tmp/linkage/linkage-credentials.json   # mintLinkageCredentials.ts
 * npm run test:deployed --workspace=@kitchensink/cookbook-import
 * ```
 *
 * The token lives about sixty seconds, so mint it right before the run. The recipe origin must pass the importer's
 * write gate (`src/writableOrigin.ts`): this suite creates PUBLIC recipes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FoodServiceClient } from '@kitchensink/food-service-client';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COOKBOOKS } from '../../src/cookbooks.js';
import { segmentCookbook } from '../../src/gutenbergBook.adapter.js';
import { toCandidateRecipe } from '../../src/proseRecipe.js';
import { RecipeApiClient, type CreateRecipeBody } from '../../src/RecipeApiClient.js';
import { isRecipeApiError } from '../../src/RecipeApiError.js';
import { resolveIngredientLikeAUser } from '../../src/resolveIngredient.js';
import { removeCreatedRecipes, type CreatedRecipe } from './support/createdRecipes.js';
import { curatorTokenOf } from './support/curatorCredential.js';
import { readDeployedImportTarget } from './support/deployedImportTarget.js';

const TARGET = readDeployedImportTarget(process.env);

/** The refusal case's bearer, when a caller supplied one. */
const UNGRANTED_TOKEN = TARGET.kind === 'present' ? TARGET.ungrantedToken : undefined;

/** The committed excerpts — the same public-domain text the unit tier parses. */
const FIXTURE = readFileSync(join(import.meta.dirname, '../../fixtures/cookbookExcerpts.txt'), 'utf-8');

/** The one block in the fixture that parses cleanly, so the suite drives a REAL parsed recipe. */
const BLOCK = segmentCookbook(FIXTURE).find((candidate) => candidate.title.startsWith('BEET SOUP'));

/** The book the fixture block comes from. */
const BOOK = COOKBOOKS['international-jewish'];

/** What the suite builds once, before its cases. */
interface Run {
    readonly recipeOrigin: string;
    /** The importer's own client, as the curator. */
    readonly importer: RecipeApiClient;
    /** The house client, as the same curator, for cleanup. */
    readonly owner: RecipeServiceClient;
    readonly body: CreateRecipeBody;
}

/**
 * A value the case's skip condition already established, for the body TypeScript cannot narrow into.
 *
 * @param value - The value.
 * @param what - What it is, for the error.
 * @returns The value.
 * @throws {Error} When it is absent although the case ran.
 */
function established<T>(value: T | undefined, what: string): T {
    if (value === undefined) {
        throw new Error(`${what} is absent, but the case did not skip`);
    }

    return value;
}

describe.skipIf(TARGET.kind === 'absent')('the curated cookbook import against a deployed stage', () => {
    let run: Run;
    const created: CreatedRecipe[] = [];

    beforeAll(async () => {
        const target = established(TARGET.kind === 'present' ? TARGET : undefined, 'the deployed target');
        const token = curatorTokenOf(readFileSync(target.credentialsPath, 'utf-8'));
        const importer = new RecipeApiClient({ baseUrl: target.recipeOrigin, token });
        const food = new FoodServiceClient({ baseUrl: target.foodOrigin, token });

        if (BLOCK === undefined || BOOK === undefined) {
            throw new Error('fixture or registry entry missing');
        }

        const outcome = toCandidateRecipe(BLOCK, BOOK);

        if (outcome.kind !== 'candidate') {
            throw new Error(`the fixture recipe no longer parses: ${outcome.reason}`);
        }

        const lines: CreateRecipeBody['ingredients'][number][] = [];

        for (const parsed of outcome.recipe.ingredients) {
            // The parser's own `exact | range | absent` reading travels through unaltered; this tier proves the
            // shipped contract accepts it.
            const resolution = await resolveIngredientLikeAUser({ food, recipe: importer }, parsed.name);

            lines.push({
                ingredientId: resolution.ingredient.id,
                quantity: parsed.quantity,
                ...(parsed.unit === null ? {} : { unit: parsed.unit }),
                notes: parsed.raw,
            });
        }

        run = {
            recipeOrigin: target.recipeOrigin,
            importer,
            owner: new RecipeServiceClient({ baseUrl: target.recipeOrigin, token }),
            body: {
                // Unique per run, so a case never reads an earlier run's recipe.
                title: `${outcome.recipe.title} [deployed e2e ${Date.now()}]`,
                description: outcome.recipe.description,
                visibility: 'public',
                servings: outcome.recipe.servings,
                prepTimeMinutes: outcome.recipe.prepTimeMinutes,
                cookTimeMinutes: outcome.recipe.cookTimeMinutes,
                totalTimeMinutes: outcome.recipe.totalTimeMinutes,
                ingredients: lines,
                steps: outcome.recipe.steps.map((instruction) => ({ instruction })),
                source: {
                    sourceType: 'imported_public',
                    sourceUrl: BOOK.sourceUrl,
                    sourceAttribution: BOOK.attribution,
                },
            },
        };
    });

    afterAll(async () => {
        await expect(removeCreatedRecipes(created)).resolves.toEqual(created.map((recipe) => recipe.id));
    });

    it('resolves every parsed ingredient name to a REAL catalog row through the product’s own lookup', () => {
        // Not one name was dropped for failing to match: the ladder ends in a freeform row, never in a discarded
        // line, which is what keeps the resolution rate's denominator honest.
        expect(run.body.ingredients.length).toBeGreaterThanOrEqual(3);

        for (const line of run.body.ingredients) {
            expect(line.ingredientId).toMatch(/^[0-9a-f-]{36}$/);
        }
    });

    it('reaches a real food record for at least one ingredient — the linkage this exercise exists to prove', async () => {
        // "At least one", not a rate: the rate moves with the catalog and belongs in the import report. What must
        // never regress to zero is the linkage itself.
        const statuses = await Promise.all(
            run.body.ingredients.map(async (line) => run.importer.getIngredientStatus(line.ingredientId)),
        );

        expect(statuses.some((ingredient) => ingredient.foodId !== undefined)).toBe(true);
    });

    it('CREATES the recipe, and the declared provenance survives to the read model', async () => {
        const recipe = await run.importer.createRecipe(run.body);

        created.push({ id: recipe.id, owner: run.owner });

        expect(recipe.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(recipe.sourceType).toBe('imported_public');
        expect(recipe.sourceUrl).toBe(BOOK?.sourceUrl);
        expect(recipe.sourceAttribution).toBe(BOOK?.attribution);
        expect(recipe.visibility).toBe('public');

        // C-004: a public imported recipe is NOT a premium capability, so no upgrade gate is implied.
        expect(recipe.usesPremiumCapability).toBe(false);

        // The parsed content actually arrived — a create that silently dropped the arrays would still 201.
        expect(recipe.ingredients.length).toBe(run.body.ingredients.length);
        expect(recipe.steps.length).toBe(run.body.steps.length);
        expect(recipe.steps.map((step) => step.stepNumber)).toEqual(run.body.steps.map((_step, index) => index + 1));
    });

    it.skipIf(UNGRANTED_TOKEN === undefined)(
        'REFUSES the same body 403 for a caller without the curator grant',
        async () => {
            const token = established(UNGRANTED_TOKEN, 'COOKBOOK_IMPORT_UNGRANTED_TOKEN');
            const ungranted = new RecipeApiClient({ baseUrl: run.recipeOrigin, token });
            // A create the service wrongly admits is still this run's recipe, so it is cleaned up as its owner.
            const outcome = await ungranted.createRecipe({ ...run.body, title: `${run.body.title} ungranted` }).then(
                (recipe) => {
                    created.push({
                        id: recipe.id,
                        owner: new RecipeServiceClient({ baseUrl: run.recipeOrigin, token }),
                    });

                    return recipe;
                },
                (error: unknown) => error,
            );

            expect(outcome).toSatisfy(
                (error: unknown) => isRecipeApiError(error) && error.status === 403 && error.code === 'FORBIDDEN',
            );
        },
    );
});
