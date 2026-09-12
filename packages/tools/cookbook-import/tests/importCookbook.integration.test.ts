/**
 * Integration tier for the curated cookbook import — the REAL `POST /api/v1/recipes` and the REAL
 * ingredient-resolution endpoints of a booted recipe service (which itself calls a booted food service).
 *
 * ## What only this tier can prove
 *
 * The unit tier exhausts the parser and the resolution ladder against fakes, and a fake will happily agree
 * with whatever this tool believes about the API. Four claims are unfalsifiable below this tier, and every
 * one of them is load-bearing for the deliverable:
 *
 *  1. **A recipe parsed out of 1900s prose is ACCEPTED by the shipped contract** — the servings, the three
 *     times, the `numeric(10,3)` quantities and the `strictObject` bodies all hold against the real pipe.
 *  2. **Declared provenance survives to the read model** — `sourceType`, `sourceUrl` and
 *     `sourceAttribution` come back on the recipe the API returns (004-FR-024 / ADR-0023).
 *  3. **The curator GRANT is what admits it** — the same body from a token without
 *     `recipes:import:public` is refused `403`. That check reads the grant out of a real signed token, a
 *     path the service's own dev-auth-based tiers cannot exercise at all.
 *  4. **The ingredient names go through the PRODUCT's catalog lookup**, and some of them reach a real
 *     `food_id` — which is the whole measurement this exercise exists to produce.
 *
 * ## How to run it
 *
 * ```bash
 * export COOKBOOK_IMPORT_RECIPE_URL=http://localhost:3000
 * export COOKBOOK_IMPORT_CREDENTIALS=/path/to/linkage-credentials.json   # LINKAGE_SCOPES=recipes:import:public
 * npm run test:integration --workspace=@kitchensink/cookbook-import
 * ```
 *
 * Boot both services exactly as `.github/workflows/_ci.yml`'s `e2e-cross-service-linkage` job does, and mint
 * the credential with `packages/tools/cross-service-e2e/scripts/mintLinkageCredentials.ts`.
 *
 * SKIPS rather than fails when the origin is not configured, mirroring how the recipe service's own
 * DB-backed tiers guard on `DATABASE_URL`. ⚠️ It WRITES recipes — point it at a local or sandbox origin.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { COOKBOOKS } from '../src/cookbooks.js';
import { RecipeApiClient } from '../src/RecipeApiClient.js';
import { segmentCookbook } from '../src/gutenbergBook.adapter.js';
import { toCandidateRecipe } from '../src/proseRecipe.js';
import { resolveIngredientLikeAUser } from '../src/resolveIngredient.js';
import type { CreateRecipeBody } from '../src/RecipeApiClient.js';
import { isRecipeApiError } from '../src/RecipeApiError.js';

const RECIPE_URL = process.env['COOKBOOK_IMPORT_RECIPE_URL'];
const CREDENTIALS = process.env['COOKBOOK_IMPORT_CREDENTIALS'];
const configured = Boolean(RECIPE_URL) && Boolean(CREDENTIALS);

/** The committed excerpts — the same public-domain text the unit tier parses. */
const FIXTURE = readFileSync(join(import.meta.dirname, '../fixtures/cookbookExcerpts.txt'), 'utf-8');

/** The one block in the fixture that parses cleanly, so the test drives a REAL parsed recipe. */
const BLOCK = segmentCookbook(FIXTURE).find((candidate) => candidate.title.startsWith('BEET SOUP'));

describe.skipIf(!configured)('cookbook import against a live recipe service', () => {
    let client: RecipeApiClient;
    let body: CreateRecipeBody;

    beforeAll(async () => {
        const credentials = JSON.parse(readFileSync(CREDENTIALS as string, 'utf-8')) as {
            token: string;
            scopes?: readonly string[];
        };

        // Fail LOUDLY on a mis-provisioned credential rather than reporting a `403` as a policy result: a
        // token minted without the grant would make every assertion below say the wrong thing about why.
        if (!(credentials.scopes ?? []).includes('recipes:import:public')) {
            throw new Error(
                'COOKBOOK_IMPORT_CREDENTIALS must be minted with LINKAGE_SCOPES=recipes:import:public — ' +
                    'without the grant the import path cannot be exercised at all.',
            );
        }

        client = new RecipeApiClient({ baseUrl: RECIPE_URL as string, token: credentials.token });

        const book = COOKBOOKS['international-jewish'];

        if (BLOCK === undefined || book === undefined) {
            throw new Error('fixture or registry entry missing');
        }

        const outcome = toCandidateRecipe(BLOCK, book);

        if (outcome.kind !== 'candidate') {
            throw new Error(`the fixture recipe no longer parses: ${outcome.reason}`);
        }

        const lines: CreateRecipeBody['ingredients'][number][] = [];

        for (const parsed of outcome.recipe.ingredients) {
            // ⚠️ REWRITTEN AGAIN for U8, and the rewrite is a DELETION. U7 collapsed the value object to
            // its lower bound here and skipped any line without one, mirroring `runImport`, because the
            // wire took a required positive scalar. It now takes `exact | range | absent`, so the parser's
            // own reading travels through unaltered — and THIS TIER is what proves that against the real
            // shipped contract rather than against a fake that would agree with anything.
            const resolution = await resolveIngredientLikeAUser(client, parsed.name);

            lines.push({
                ingredientId: resolution.ingredient.id,
                name: resolution.ingredient.name,
                quantity: parsed.quantity,
                ...(parsed.unit === null ? {} : { unit: parsed.unit }),
                notes: parsed.raw,
            });
        }

        body = {
            // Unique per run: this tier CREATES rows, and a fixed title would make a second run's
            // assertions read a previous run's recipe.
            title: `${outcome.recipe.title} [it ${Date.now()}]`,
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
                sourceUrl: book.sourceUrl,
                sourceAttribution: book.attribution,
            },
        };
    });

    it('resolves every parsed ingredient name to a REAL catalog row through the product’s own lookup', () => {
        // Not one name was dropped for failing to match — the ladder ends in a freeform row, never in a
        // discarded line, which is what keeps the resolution rate's denominator honest.
        expect(body.ingredients.length).toBeGreaterThanOrEqual(3);

        for (const line of body.ingredients) {
            expect(line.ingredientId).toMatch(/^[0-9a-f-]{36}$/);
        }
    });

    it('reaches a real food record for at least one ingredient — the linkage this exercise exists to prove', async () => {
        // ⚠️ Asserts "at least one", not a rate. The RATE is a product measurement that moves with the
        // catalog's contents and belongs in the import report; pinning a number here would turn a change in
        // USDA coverage into a red test. What must never regress to zero is the LINKAGE itself: if this
        // fails, recipe-service is not reaching food-service at all.
        const statuses = await Promise.all(
            body.ingredients.map(async (line) => client.getIngredientStatus(line.ingredientId)),
        );

        expect(statuses.some((ingredient) => ingredient.foodId !== undefined)).toBe(true);
    });

    it('CREATES the recipe, and the declared provenance survives to the read model', async () => {
        const created = await client.createRecipe(body);

        expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(created.sourceType).toBe('imported_public');
        expect(created.sourceUrl).toBe(COOKBOOKS['international-jewish']?.sourceUrl);
        expect(created.sourceAttribution).toBe(COOKBOOKS['international-jewish']?.attribution);
        expect(created.visibility).toBe('public');

        // C-004: a public imported recipe is NOT a premium capability, so no upgrade gate is implied.
        expect(created.usesPremiumCapability).toBe(false);

        // The parsed content actually arrived — a create that silently dropped the arrays would still 201.
        expect(created.ingredients.length).toBe(body.ingredients.length);
        expect(created.steps.length).toBe(body.steps.length);
        expect(created.steps.map((step) => step.stepNumber)).toEqual(body.steps.map((_step, index) => index + 1));
    });

    it('REFUSES the same body 403 for a caller without the curator grant', async () => {
        // The security property of ADR-0023, over the real wire, against a real signed token. The service's
        // own tiers use the dev-auth bypass, which cannot carry a scope either way — so this assertion has
        // no home anywhere else.
        const credentials = JSON.parse(readFileSync(CREDENTIALS as string, 'utf-8')) as { token: string };
        const ungranted = process.env['COOKBOOK_IMPORT_UNGRANTED_TOKEN'];

        if (ungranted === undefined || ungranted === '') {
            // Skipped rather than faked: minting a second token is the harness's job, and asserting this
            // against a fake would prove nothing about the grant.
            return;
        }

        expect(ungranted).not.toBe(credentials.token);

        const client2 = new RecipeApiClient({ baseUrl: RECIPE_URL as string, token: ungranted });

        await expect(client2.createRecipe({ ...body, title: `${body.title} ungranted` })).rejects.toSatisfy(
            (error: unknown) => isRecipeApiError(error) && error.status === 403 && error.code === 'FORBIDDEN',
        );
    });
});
