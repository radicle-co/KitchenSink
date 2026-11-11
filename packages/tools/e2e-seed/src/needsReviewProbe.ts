/**
 * The owner's recipe whose one line reads NEEDS_REVIEW, made for `recipes/needsReviewJump` — LOCAL stack only.
 *
 * NEEDS_REVIEW is DERIVED at read time (`resolveLineStatus`): a stored `contradicted` verdict whose identity reading is not
 * `contradict`. The verdict's only writer is the Bedrock verification worker, which the local stack does not run, so this
 * module creates the recipe through the API and stores the verdict itself through a {@link SeedVerdictStore}. The store is a
 * port: the only adapter (`verdictStore.ts`) is built from a `LocalSeedTarget`, which only `requireLocalSeedTarget` makes.
 *
 * ⛔ THE KEY IS THE READ'S KEY. `verificationKey()` (recipe-core, the function the service and the worker both use) hashes
 * the normalized source line, the food-SERVICE id the line is bound to, the parsed measure and the stated measure. A key
 * that is one byte off stores a row nothing ever finds, and the flow behind it fails on a step that reads like an app
 * defect. So the seed computes it with recipe-core's own function and then READS THE RECIPE BACK: unless the line reads
 * NEEDS_REVIEW the reset throws, naming what it read. That read-back is the proof; no unit test can supply it.
 *
 * @pattern Command (create, store, verify) behind a Port (the verdict store); the key is Specification-derived by recipe-core
 */
import { createHash } from 'node:crypto';

import type { FoodServiceClient } from '@kitchensink/food-service-client';
import { verificationKey, type VerifiedLineIdentity } from '@kitchensink/recipe-core/resolution/verification-key';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';

import type { FixtureRecipe } from './fixtureManifest.js';
import { ensureAuthoredFood, toCreateRequest } from './recipeWorld.js';

/**
 * The marker every row this seed writes carries in `model_id`. It is how the seed removes its own previous row and ONLY its
 * own: no verdict a worker wrote can carry it, so a clean-up can never delete a real verdict.
 */
export const NEEDS_REVIEW_SEED_MODEL_ID = 'e2e-seed:needsReview';

/** One `recipe_ingredient_verifications` row, in the columns the read uses. */
export interface SeedVerdictRow {
    readonly verificationKey: string;
    readonly verdict: 'disagree';
    readonly certainty: 'high';
    readonly band: 'contradicted';
    readonly aspects: readonly ['quantity'];
    readonly identityVerdict: null;
    readonly quantityVerdict: 'disagree';
    readonly modelId: typeof NEEDS_REVIEW_SEED_MODEL_ID;
    readonly foodId: string;
    readonly foodVariantId: null;
}

/** Where the verdict goes. The adapter refuses anything but the local database. */
export interface SeedVerdictStore {
    /** Remove the seed's previous row, then write this one. @sideEffect Writes the recipe database. */
    readonly replaceSeedVerdict: (row: SeedVerdictRow) => Promise<void>;
}

const sha256Hex = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

/**
 * The verdict row for a line: a high-certainty disagreement about the QUANTITY, with identity never asked.
 *
 * That is what separates NEEDS_REVIEW from AMBIGUOUS: `resolveLineStatus` answers AMBIGUOUS for a contradicted band only when
 * the identity reading is `contradict` (identity among the aspects asked, itemised `disagree`, at high certainty). A
 * quantity-only dispute keeps NEEDS_REVIEW "because a food re-pick cannot fix an amount", which is the row editor sheet the
 * flow opens. Pure.
 *
 * @param line - The line as it is stored: its source text, the bound food's id at the FOOD service (a root's id, never the
 *   binding's), and the parsed measure.
 * @returns The row, keyed as the read derives the key.
 */
export function needsReviewVerdictFor(line: {
    readonly sourceLine: string;
    readonly foodRefId: string;
    readonly quantity: number;
    readonly unit: string;
}): SeedVerdictRow {
    const identity: VerifiedLineIdentity = {
        sourceLine: line.sourceLine,
        foodRefId: line.foodRefId,
        quantityLow: line.quantity,
        quantityHigh: null,
        unit: line.unit.trim() === '' ? null : line.unit,
        statedMeasure: null,
    };

    return {
        verificationKey: verificationKey(identity, sha256Hex),
        verdict: 'disagree',
        certainty: 'high',
        band: 'contradicted',
        aspects: ['quantity'],
        identityVerdict: null,
        quantityVerdict: 'disagree',
        modelId: NEEDS_REVIEW_SEED_MODEL_ID,
        foodId: line.foodRefId,
        foodVariantId: null,
    };
}

/** The calls the probe needs: its food's, and the recipe routes that create it and read the status back. */
export interface NeedsReviewProbeClients {
    readonly food: Pick<FoodServiceClient, 'createAuthoredFood'>;
    readonly recipe: Pick<RecipeServiceClient, 'addIngredientByFood' | 'createRecipe' | 'getRecipeById'>;
}

/**
 * Create the signer's needs-review probe, store its verdict, and prove the line reads NEEDS_REVIEW.
 *
 * Order: the food (authored, or the one the signer already has under that name), the recipe bound to it, the verdict, then one
 * read. The read is not polled: the status is derived from the stored row at read time, so a row that is going to be found is
 * found at once, and one that is not never will be.
 *
 * Does not delete an older probe: `planWorldReset` already did, as residue, before this runs. The previous verdict row is
 * replaced by {@link SeedVerdictStore.replaceSeedVerdict}.
 *
 * @param clients - Clients authenticated as the SIGNER, the food's author and the recipe's owner.
 * @param store - Where the verdict goes; local only.
 * @param recipe - The run-scoped fixture (`deriveNeedsReviewProbe`).
 * @param foodName - The food the line is bound to.
 * @returns The recipe's id.
 * @throws {Error} When the food is not a food, when the recipe cannot be created, or when the line does not read NEEDS_REVIEW.
 * @sideEffect May author a food; creates one recipe; writes the recipe database; reads the recipe.
 */
export async function ensureNeedsReviewProbe(
    clients: NeedsReviewProbeClients,
    store: SeedVerdictStore,
    recipe: FixtureRecipe,
    foodName: string,
): Promise<string> {
    const line = recipe.ingredients[0];

    if (line?.sourceLine === undefined) {
        throw new Error(
            `e2e-seed: "${recipe.title}" has no line carrying a source line, so no verdict can be about it`,
        );
    }

    const binding = await ensureAuthoredFood(
        { food: clients.food, recipe: clients.recipe },
        foodName,
        'the needs-review food',
    );

    // ⛔ The food SERVICE's id, not the binding's: the key is made over what the line is bound to at food.
    if (binding.foodId === undefined) {
        throw new Error(`e2e-seed: the needs-review food "${foodName}" came back with no food id, so it is not a food`);
    }

    const created = await clients.recipe.createRecipe(toCreateRequest(recipe, new Map([[foodName, binding.id]])));

    await store.replaceSeedVerdict(
        needsReviewVerdictFor({
            sourceLine: line.sourceLine,
            foodRefId: binding.foodId,
            quantity: line.quantity,
            unit: line.unit ?? '',
        }),
    );

    const detail = await clients.recipe.getRecipeById(created.id);
    const statuses = detail.ingredients.map((read) => read.resolutionStatus ?? 'none');

    if (statuses.length === 0 || !statuses.every((status) => status === 'NEEDS_REVIEW')) {
        throw new Error(
            `e2e-seed: "${recipe.title}" should read NEEDS_REVIEW on every line after its verdict was stored, but its ` +
                `${recipe.ingredients.length} line(s) read: ${statuses.join(', ') || 'no lines'}. A line that reads RESOLVED or ` +
                'PENDING_VERIFICATION means the stored key is not the one the read derives; one that reads AMBIGUOUS means ' +
                'the verdict was read as an identity contradiction.',
        );
    }

    return created.id;
}
