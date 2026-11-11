/**
 * What an imported recipe still lacks before it can be saved PUBLISHED (ADR-0072 §3 as amended 2026-11-11).
 *
 * The import saves every recipe published, never as a draft, so a recipe must meet what Publish needs and what the create
 * route requires. A file often states no cuisine, no servings or no times (another app's export), and nothing makes one up: no
 * default, no zero, no AI pick. The item waits in the import under "Needs a cuisine", "Needs servings" or "Needs times" until
 * the cook gives them, as it waits under "Needs your statement". A recipe with no ingredient line or no step is not held but
 * REFUSED (`importRefusalOf`), so it never gets here.
 *
 * DESIGN PATTERN: **Adapter** onto the ONE publish policy (`evaluatePublication`), never a second copy of its rule, plus a
 * pure **resolution** of each fact the save sends (the cook's choice over the file's). The policy is fed the provenance the
 * cook's statement sets (`resolveStatementProvenance`), so a web statement is a web copy that needs a cuisine, exactly as it
 * is on every other route (ADR-0089). The step, the save and the item list all read the facts through
 * {@link importSaveFactsOf}, so what the wizard shows is what the save sends.
 */
import { RecipeStatus, recipeCuisineSchema } from '@kitchensink/recipe-core';
import { z } from 'zod';

import { evaluatePublication } from '../../recipes/domain/publishPolicy.js';
import { resolveStatementProvenance } from '../../recipes/domain/provenancePolicy.js';
import type { KnownImportStatement } from './importStatement.js';

/** What the first thing the save still needs is. In the order the cook is asked. */
export type ImportSaveGap = 'cuisine' | 'servings' | 'times';

/** What a recipe file states of the facts the save needs. Each is `null` when the file does not state it. */
export interface ImportFileFacts {
    readonly cuisine: string | null;
    readonly servings: number | null;
    readonly prepTimeMinutes: number | null;
    readonly cookTimeMinutes: number | null;
    readonly totalTimeMinutes: number | null;
}

/** What the cook gave in the import for these facts. Each is `null` when the cook gave none. */
export interface ImportCookChoices {
    readonly cuisine: string | null;
    readonly servings: number | null;
    readonly prepTimeMinutes: number | null;
    readonly cookTimeMinutes: number | null;
}

/** The facts the save sends, resolved. Each is `null` when neither the cook nor the file stated it. */
export type ImportResolvedFacts = ImportFileFacts;

/** What the save gap is judged on. */
export interface ImportSaveFacts {
    readonly statement: KnownImportStatement;
    readonly cuisine: string | null;
    readonly servings: number | null;
    readonly prepTimeMinutes: number | null;
    readonly cookTimeMinutes: number | null;
    /** The file's ingredient lines. The save writes at least one line per file line, so this is the saved count's floor. */
    readonly ingredientLineCount: number;
    readonly stepCount: number;
}

/** The fields of a stored payload the save facts are read from; the rest of the document is not parsed for them. */
const payloadFactsSchema = z.object({
    cuisine: recipeCuisineSchema.optional(),
    servings: z.number().int().optional(),
    prepTimeMinutes: z.number().int().optional(),
    cookTimeMinutes: z.number().int().optional(),
    totalTimeMinutes: z.number().int().optional(),
});

const NOTHING_STATED: ImportFileFacts = {
    cuisine: null,
    servings: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    totalTimeMinutes: null,
};

/**
 * What a stored payload states, or nothing: no payload (a saved item's is dropped) or one that does not read. Pure.
 *
 * @param payload - `recipe_import_items.payload`, as the contract admitted it.
 */
export function fileSaveFactsOf(payload: unknown): ImportFileFacts {
    const read = payloadFactsSchema.safeParse(payload);

    if (!read.success) {
        return NOTHING_STATED;
    }

    return {
        cuisine: read.data.cuisine ?? null,
        servings: read.data.servings ?? null,
        prepTimeMinutes: read.data.prepTimeMinutes ?? null,
        cookTimeMinutes: read.data.cookTimeMinutes ?? null,
        totalTimeMinutes: read.data.totalTimeMinutes ?? null,
    };
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
 * The facts the save sends: each is the cook's choice, else the file's, else `null`. Pure.
 *
 * The total is the FILE's when it states one. Otherwise it is prep plus cook when both are known, and `null` when either is
 * not. A file that states only a total leaves prep and cook unknown, so it holds until the cook gives them.
 *
 * @param chosen - What the cook gave.
 * @param file - What the file states.
 */
export function importSaveFactsOf(chosen: ImportCookChoices, file: ImportFileFacts): ImportResolvedFacts {
    const prepTimeMinutes = chosen.prepTimeMinutes ?? file.prepTimeMinutes;
    const cookTimeMinutes = chosen.cookTimeMinutes ?? file.cookTimeMinutes;
    const derivedTotal =
        prepTimeMinutes === null || cookTimeMinutes === null ? null : prepTimeMinutes + cookTimeMinutes;

    return {
        cuisine: importCuisineOf(chosen.cuisine, file.cuisine),
        servings: chosen.servings ?? file.servings,
        prepTimeMinutes,
        cookTimeMinutes,
        totalTimeMinutes: file.totalTimeMinutes ?? derivedTotal,
    };
}

/**
 * The first thing the save still needs, or `null` when the recipe can be saved. Pure.
 *
 * One key, not the list: the item list shows one issue per recipe, and the cook fixes one thing at a time. The cuisine comes
 * from the ONE publish policy; servings and times hold on an ABSENT value and never on `0`.
 *
 * @throws Error when the recipe has no ingredient line or no step: the import refuses such an item before it gets here, so
 *   reaching this is a defect, not something to hold.
 */
export function importSaveGapOf(facts: ImportSaveFacts): ImportSaveGap | null {
    const provenance = resolveStatementProvenance(facts.statement);

    // A web statement whose link is not a usable source sets no label, so there is nothing to judge here: the visibility
    // seam refuses that item, and the save never writes it.
    if (provenance === undefined) {
        return null;
    }

    const decision = evaluatePublication({
        status: RecipeStatus.PUBLISHED,
        sourceType: provenance.sourceType,
        sourceKind: provenance.sourceKind,
        cuisine: facts.cuisine,
        ingredientCount: facts.ingredientLineCount,
        stepCount: facts.stepCount,
    });

    if (!decision.allowed && (decision.missing.includes('ingredients') || decision.missing.includes('steps'))) {
        throw new Error('an item with no ingredient line or no step was refused at import and cannot be saved');
    }

    if (!decision.allowed) {
        return 'cuisine';
    }

    if (facts.servings === null) {
        return 'servings';
    }

    return facts.prepTimeMinutes === null || facts.cookTimeMinutes === null ? 'times' : null;
}
