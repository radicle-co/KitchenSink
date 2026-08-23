/**
 * The imported line must carry the source's OWN WORDS in the field U11's gate reads.
 *
 * ## The defect this was written for
 *
 * `sourceLine` is the only reason migration `0024_ingredient_source_line.sql` exists, and its schema says so:
 * "This is what U11's verification gate checks OUR PARSE AGAINST… `2 cups all-purpose flour, sifted` is a
 * source line; `Flour` is not."
 *
 * The importer never sent it. It sent the raw clause as `notes` — which reaches `display_text`, a display
 * OVERRIDE that migration 0024 explicitly rejects as a substitute — and omitted `sourceLine` entirely.
 * `decideVerification` reads an absent source line as `skip: 'no-source-text'`, so **every line of the
 * 448-recipe corpus the whole plan is measured against would have been skipped by the gate**, and the queue
 * producer being built for U11 would have shipped messages that all skip.
 *
 * ⚠️ Nothing caught it because the field is `.optional()` and the importer types its body as
 * `z.input<typeof createRecipeRequestSchema>` — omitting an optional field is not a compile error. The same
 * "invisible by construction" shape the plan flagged elsewhere.
 *
 * ## Why a pure function rather than a `runImport` test
 *
 * `runImport` takes a concrete `RecipeApiClient` and performs network I/O over a whole book. The judgement
 * — what a line carries — is extracted beside it as a pure function, which is this repository's own
 * pure-`decide` / impure-`evaluate` split, and lets the rule be asserted as a table.
 */
import { describe, expect, it } from 'vitest';

import { toImportedIngredientLine } from '../importedIngredientLine.js';

/** A parsed clause, as `parseIngredientLine` returns it. */
const parsed = {
    raw: '2 cups all-purpose flour, sifted',
    name: 'all-purpose flour',
    quantity: { kind: 'exact' as const, value: 2 },
    unit: 'cup',
};

/** The catalog row the resolver settled on. */
const ingredient = { id: 'ing_1', name: 'Flour, all purpose', foodId: 'food_1' };

describe('toImportedIngredientLine', () => {
    it('⛔ sends the source clause as `sourceLine`, which is what the gate reads', () => {
        expect(toImportedIngredientLine(parsed, ingredient).sourceLine).toBe('2 cups all-purpose flour, sifted');
    });

    it('⛔ never sends the ingredient NAME as the source line', () => {
        // Verifying a parse against a string we produced FROM that parse is circular and always agrees —
        // "a gate that reports success by construction", in the schema's own words.
        const line = toImportedIngredientLine(parsed, ingredient);

        expect(line.sourceLine).not.toBe(ingredient.name);
        expect(line.sourceLine).not.toBe(parsed.name);
    });

    it('references the catalog row and carries the parsed values through unchanged', () => {
        const line = toImportedIngredientLine(parsed, ingredient);

        expect(line.ingredientId).toBe('ing_1');
        expect(line.name).toBe('Flour, all purpose');
        expect(line.quantity).toStrictEqual({ kind: 'exact', value: 2 });
        expect(line.unit).toBe('cup');
    });

    it('omits `unit` entirely when the clause stated none', () => {
        // An omitted key and an empty string are different facts on this wire; `null` is not accepted.
        expect(toImportedIngredientLine({ ...parsed, unit: null }, ingredient)).not.toHaveProperty('unit');
    });

    it('keeps `notes` carrying the clause too — display and transcription are different jobs', () => {
        // Migration 0024 calls `display_text` a display OVERRIDE and refuses it as a substitute for
        // `source_line`. They hold the same string here and are not the same fact; changing what an
        // imported line DISPLAYS is a separate decision from what the gate verifies against.
        expect(toImportedIngredientLine(parsed, ingredient).notes).toBe('2 cups all-purpose flour, sifted');
    });
});

describe('⛔ the source line must be the SOURCE’s words, not ours', () => {
    /**
     * `parsed.raw` is byte-identical only to what `parseIngredientLine` RECEIVED, and the prose scanner
     * normalizes before calling it: `proseRecipe.ts` runs `dropPartitiveOf`, which runs `normalizeQuantity`,
     * which maps `one` to `1` through `WHOLE_NUMBER_WORDS`. So `raw` for "one gill of milk" is already
     * "1 gill of milk" — a string WE produced.
     *
     * That matters because `recipeIngredientSourceLineSchema` says what the field is for: "verifying a parse
     * against a string we ourselves produced from that parse is circular and always agrees, which is a gate
     * that reports success by construction." Sending `raw` was exactly that, and I shipped it.
     *
     * The verbatim clause survives in the scanner as `trimmed.slice(at)` for the winning suffix, so the
     * candidate carries it and the wire sends THAT.
     */
    it('sends the pre-normalization clause, not the parser’s normalized input', () => {
        const line = toImportedIngredientLine(
            { ...parsed, raw: '1 gill of milk', sourceText: 'one gill of milk' },
            ingredient,
        );

        expect(line.sourceLine).toBe('one gill of milk');
        expect(line.sourceLine).not.toBe('1 gill of milk');
    });

    it('falls back to the parser’s input when no verbatim clause was captured', () => {
        // An authored line reaches this function without a scanner, so there is no earlier text to prefer.
        // Falling back is right; silently preferring `raw` when `sourceText` EXISTS is the defect above.
        expect(toImportedIngredientLine(parsed, ingredient).sourceLine).toBe(parsed.raw);
    });
});
