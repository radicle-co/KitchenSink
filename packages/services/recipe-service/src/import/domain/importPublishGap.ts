/**
 * What an imported recipe still lacks before it can be saved PUBLISHED (ADR-0072 §3 as amended 2026-11-11).
 *
 * The import saves every recipe published, never as a draft, so a recipe must meet what Publish needs. A file often states
 * no cuisine (another app's export), and nothing makes one up: no default, no AI pick. The item waits in the import under
 * "Needs a cuisine" until the cook gives one, as it waits under "Needs your statement".
 *
 * DESIGN PATTERN: **Adapter** onto the ONE publish policy (`evaluatePublication`), never a second copy of its rule. This
 * module only gathers the import's facts into that policy's input, with the provenance the cook's statement sets, so a
 * public-domain web import is exempt from the cuisine exactly as it is on every other route. The step, the save and the
 * item list all read the cuisine through {@link importCuisineOf}, so the cuisine the wizard shows is the one the save sends.
 */
import { RecipeStatus, recipeCuisineSchema, type PublishRequirement } from '@kitchensink/recipe-core';
import { z } from 'zod';

import { evaluatePublication } from '../../recipes/domain/publishPolicy.js';
import { provenanceOfStatement, type KnownImportStatement } from './importStatement.js';

/** The facts the publish requirements are judged on, as the import knows them before the save. */
export interface ImportPublishFacts {
    readonly statement: KnownImportStatement;
    /** The cuisine the save would send ({@link importCuisineOf}), or `null`. */
    readonly cuisine: string | null;
    /** The file's ingredient lines. The save writes at least one line per file line, so this is the saved count's floor. */
    readonly ingredientLineCount: number;
    readonly stepCount: number;
}

/** The one field of a stored payload the cuisine is read from; the rest of the document is not parsed for it. */
const payloadCuisineSchema = z.object({ cuisine: recipeCuisineSchema.optional() });

/**
 * The cuisine a stored payload states, or `null`: none, or no payload (a saved item's is dropped). Pure.
 *
 * @param payload - `recipe_import_items.payload`, as the contract admitted it.
 */
export function fileCuisineOf(payload: unknown): string | null {
    const read = payloadCuisineSchema.safeParse(payload);

    return read.success ? (read.data.cuisine ?? null) : null;
}

/**
 * The cuisine the save uses: the cook's choice, else the file's, else `null`. Pure.
 *
 * @param chosen - The cuisine the cook gave in the import (`recipe_import_items.cuisine`), or `null`.
 * @param fromFile - The recipe file's own cuisine, if it states one.
 */
export function importCuisineOf(chosen: string | null, fromFile: string | null | undefined): string | null {
    return chosen ?? fromFile ?? null;
}

/**
 * The first requirement Publish still needs, in the publish policy's order, or `null` when the recipe can be published. Pure.
 *
 * One key, not the list: the item list shows one issue per recipe, and the cook fixes one thing at a time.
 */
export function importPublishGapOf(facts: ImportPublishFacts): PublishRequirement | null {
    const decision = evaluatePublication({
        status: RecipeStatus.PUBLISHED,
        sourceType: provenanceOfStatement(facts.statement).sourceType,
        cuisine: facts.cuisine,
        ingredientCount: facts.ingredientLineCount,
        stepCount: facts.stepCount,
    });

    // `missing` is non-empty and already in the policy's page order.
    return decision.allowed ? null : decision.missing[0];
}
