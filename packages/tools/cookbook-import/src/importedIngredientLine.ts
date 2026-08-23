/**
 * @module importedIngredientLine — what ONE imported ingredient line carries onto the create request.
 *
 * Extracted from `runImport`'s loop as a pure function, per this repository's pure-`decide` /
 * impure-`evaluate` split, so the rule below can be asserted as a table rather than only through a network
 * round trip over a whole book.
 *
 * ## ⛔ `sourceLine` is the reason this module exists
 *
 * It is the field U11's verification gate checks OUR PARSE AGAINST, and
 * `recipeIngredientSourceLineSchema`'s own docstring gives the test: "`2 cups all-purpose flour, sifted` is
 * a source line; `Flour` is not." The importer previously sent the clause as `notes` — which reaches
 * `display_text`, a display OVERRIDE that migration `0024_ingredient_source_line.sql` explicitly refuses as
 * a substitute — and omitted `sourceLine` altogether. `decideVerification` reads an absent source line as
 * `skip: 'no-source-text'`, so every line of the 448-recipe corpus the plan is measured against would have
 * been skipped by the gate, and a queue producer would have shipped messages that all skip.
 *
 * ⚠️ Nothing caught it because the field is `.optional()` and the request body is typed as a `z.input` of
 * the create schema: omitting an optional key is not a compile error. Hence a test that asserts the field is
 * PRESENT, not merely that the body validates.
 */
import type { IngredientQuantity } from '@kitchensink/recipe-core';

import type { CreateRecipeBody } from './RecipeApiClient.js';

/** One line on a create request, as this importer builds it. */
type ImportedIngredientLine = CreateRecipeBody['ingredients'][number];

/** The parts of a parsed clause this line is built from. */
export interface ParsedClause {
    /** The source's own words for the whole clause, verbatim. */
    readonly raw: string;
    /** The ingredient name the parser lifted out of it. */
    readonly name: string;
    /** The parsed amount, in the wire's value-object form. */
    readonly quantity: IngredientQuantity;
    /** The parsed unit, or `null` when the clause stated none. */
    readonly unit: string | null;
}

/** The catalog row the resolver settled on for that clause. */
export interface ResolvedCatalogRow {
    /** The `ingredients` row id the line references. */
    readonly id: string;
    /** The catalog's own display name. */
    readonly name: string;
    /** The food-service id behind it, when it has one. */
    readonly foodId?: string | undefined;
}

/**
 * Build the create-request line for one resolved clause.
 *
 * @param parsed - The parsed clause.
 * @param ingredient - The catalog row it resolved to.
 * @returns The line to send. Pure.
 */
export function toImportedIngredientLine(parsed: ParsedClause, ingredient: ResolvedCatalogRow): ImportedIngredientLine {
    return {
        ingredientId: ingredient.id,
        // The wire requires a name; the server overwrites it from the catalog row anyway. Sending the
        // catalog's own name keeps the request honest about what it is referencing.
        name: ingredient.name,
        quantity: parsed.quantity,
        // Omitted, never `null` or `''`: on this wire "the clause stated no unit" has exactly one
        // representation, and it is the absent key.
        ...(parsed.unit === null ? {} : { unit: parsed.unit }),
        // The source's own words, kept verbatim beside the structured values, for a reader.
        notes: parsed.raw,
        // ⛔ The same string, in the field the GATE reads. Not a duplicate of `notes` in meaning: one is a
        // display override, the other is the transcription a verdict is keyed on. See this module's header.
        sourceLine: parsed.raw,
    };
}
