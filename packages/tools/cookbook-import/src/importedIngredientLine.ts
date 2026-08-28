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
 *
 * ## ⛔ `statedMeasure` is the same defect, one field over
 *
 * `restateHistoricalUnit` OVERWRITES a restated line's `quantity`/`unit` with the converted pair — `one gill
 * of milk` becomes `0.5 cup` — and this function built the body from those. So the gate was shown a number
 * the source never printed and correctly disagreed with a correct parse. Same shape of miss, same reason
 * nothing caught it, same fix: the field is asserted PRESENT for a restated line and ABSENT otherwise.
 */
import type { IngredientQuantity } from '@kitchensink/recipe-core';

import type { CreateRecipeBody } from './RecipeApiClient.js';
import type { HistoricalUnitConversion } from './unitEquivalence.js';

/** One line on a create request, as this importer builds it. */
type ImportedIngredientLine = CreateRecipeBody['ingredients'][number];

/** The parts of a parsed clause this line is built from. */
export interface ParsedClause {
    /**
     * What `parseIngredientLine` RECEIVED.
     *
     * ⚠️ NOT the source's own words, despite the name. The prose scanner runs `normalizeQuantity` before
     * calling the parser, so `one gill of milk` arrives here as `1 gill of milk` — a string we produced.
     */
    readonly raw: string;
    /**
     * The clause exactly as the book printed it, before any normalization — `trimmed.slice(at)` for the
     * suffix the scanner accepted.
     *
     * ⛔ THIS is what `sourceLine` must carry. Absent for an authored line, which reaches this function
     * without a scanner and therefore has no earlier text to prefer.
     */
    readonly sourceText?: string | undefined;
    /** The ingredient name the parser lifted out of it. */
    readonly name: string;
    /** The parsed amount, in the wire's value-object form. */
    readonly quantity: IngredientQuantity;
    /** The parsed unit, or `null` when the clause stated none. */
    readonly unit: string | null;
    /**
     * What is done TO the food, when the two-engine pipeline read one — `chopped`, `sifted`, `melted`.
     *
     * ⛔ ABSENT on the library path, which cannot produce it. KTD-11b's prep/identity split is one of the
     * pipeline's reasons to exist, and the field is `.optional()` on the create schema, so an absent
     * preparation and an empty one are different facts — hence the conditional spread below.
     */
    readonly preparation?: string | undefined;
    /**
     * The historical-unit restatement this line went through, when it went through one (R35).
     *
     * ⛔ THE WHOLE CONVERSION, not a pre-extracted `statedMeasure`. `restateHistoricalUnit` already attaches
     * exactly this value to the candidate line, so taking a second copy of half of it would be two
     * representations of one fact — and the two would drift the moment the conversion grows a field.
     *
     * ⚠️ Its PRESENCE is the disclosure that {@link quantity}/{@link unit} above are NOT what the source
     * printed: `restateHistoricalUnit` overwrites them with the restated pair. There is no "not applicable"
     * value, exactly as with `RecipeNutrition.rangeDerivedBound`.
     */
    readonly unitConversion?: HistoricalUnitConversion | undefined;
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
        ...(parsed.preparation === undefined ? {} : { preparation: parsed.preparation }),
        // The source's own words, kept verbatim beside the structured values, for a reader.
        notes: parsed.raw,
        // ⛔ The field the GATE reads, and it must be the SOURCE's words. `raw` is only byte-identical to
        // what the parser received, and the scanner normalizes first (`dropPartitiveOf` → `normalizeQuantity`
        // → `one` becomes `1`), so sending `raw` would verify our parse against a string we produced from
        // that parse — "a gate that reports success by construction", in the schema's own words. Not a
        // duplicate of `notes` in meaning either: one is a display override, the other is the transcription
        // a verdict is keyed on.
        sourceLine: parsed.sourceText ?? parsed.raw,
        // ⛔ WHAT THE SOURCE PRINTED, when `quantity`/`unit` above are a RESTATEMENT of it (R35). Without it
        // U11's gate is shown a source line reading `one gill of milk` beside a parse claiming `0.5 cup` and
        // asked whether they agree — a manufactured false DISAGREE about a line we parsed CORRECTLY, which
        // U11 ranks as the unacceptable direction because it withholds nutrition from a correct line.
        //
        // Omitted, never `null`: absence is how this wire spells "these values ARE what the source said",
        // which is every authored line and every line stating a modern unit.
        ...(parsed.unitConversion === undefined ? {} : { statedMeasure: parsed.unitConversion.stated }),
    };
}
