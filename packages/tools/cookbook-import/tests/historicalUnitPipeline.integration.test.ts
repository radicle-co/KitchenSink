/**
 * Integration tier — prose stating a HISTORICAL measure, all the way to a body the SHIPPED contract
 * accepts (R32, R33, R34, R35).
 *
 * ## What only this tier can prove
 *
 * The unit tier pins each stage against the stage next to it. Four claims live in the SEAMS between them
 * and are unfalsifiable one stage at a time:
 *
 *  1. **The real `parse-ingredient` tokenizes a word we taught it** — `IMPORT_UNITS` is an extension point
 *     of a third-party library, and a mock of that library would agree with whatever we believe about it.
 *     Before U7 the tokenizer returned `unitOfMeasure: null` for a gill and `ingredientInClause`'s
 *     unit gate DROPPED the whole line, so a historical measure cost its ingredient outright.
 *  2. **The restated value is STORABLE.** A conversion divides one measure by another and lands on
 *     0.6004…; `recipeIngredientQuantitySchema` and the `numeric(10,3)` column are what decide whether
 *     that is a number the service will take. A unit test asserting `0.6` proves arithmetic, not
 *     acceptance.
 *  3. **The whole create body still validates** against `@kitchensink/schema-recipe`'s OWN
 *     `createRecipeRequestSchema` — the committed copy of the service's authored contract (ADR-0014), not
 *     this tool's belief about it. `strictObject` members mean a restated quantity that acquired a stray
 *     key would be refused at the boundary.
 *  4. **The source's own words survive the restatement** into `notes` and `sourceLine`, which is what
 *     makes R35's marker checkable by a human reading the recipe rather than only by a machine.
 *
 * ⛔ This tier needs NO booted service and NO network, so unlike `importCookbook.integration.test.ts` it
 * never skips. The boundary it crosses is the CONTRACT and the third-party parser, not the transport.
 *
 * ⚠️ The prose is written for this test. The committed corpus slice contains no gill or wineglassful, and
 * `goldenCorpusParse.ts` carries a VERBATIM rule — every phrase in it must occur in the committed source —
 * so inventing one there would turn the golden into the fiction that rule exists to prevent. Nothing here
 * claims the book says this; it claims the PIPELINE does this.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { createRecipeRequestSchema } from '@kitchensink/schema-recipe';

import { COOKBOOKS } from '../src/cookbooks.js';
import { toImportedIngredientLine } from '../src/importedIngredientLine.js';
import { toCandidateRecipe, type CandidateIngredient } from '../src/proseRecipe.js';
import type { CookbookBlock } from '../src/gutenbergBook.adapter.js';
import type { CreateRecipeBody } from '../src/RecipeApiClient.js';

/** One prose block stating three historical measures and nothing else unusual. */
const BLOCK: CookbookBlock = {
    title: 'A SAUCE FOR PUDDING',
    paragraphs: [
        'Take one gill of milk, one wineglassful of sherry and two saltspoons of salt, and put them ' +
            'together in a small saucepan over a gentle fire. Stir the mixture without ceasing until it is ' +
            'quite smooth and begins to thicken, then draw it to the side of the stove. Let it cook slowly ' +
            'half an hour and serve it very hot with a plain boiled pudding.',
    ],
};

/** Map the block for one registered book, failing loudly rather than asserting against a skip. */
function candidateFor(bookKey: string): {
    readonly lines: readonly CandidateIngredient[];
    readonly body: CreateRecipeBody;
} {
    const book = COOKBOOKS[bookKey];
    const outcome = toCandidateRecipe(BLOCK, book);

    if (outcome.kind !== 'candidate') {
        throw new Error(`the historical-unit block no longer parses: ${outcome.reason}`);
    }

    return {
        lines: outcome.recipe.ingredients,
        body: {
            title: outcome.recipe.title,
            description: outcome.recipe.description,
            visibility: 'public',
            servings: outcome.recipe.servings,
            prepTimeMinutes: outcome.recipe.prepTimeMinutes,
            cookTimeMinutes: outcome.recipe.cookTimeMinutes,
            totalTimeMinutes: outcome.recipe.totalTimeMinutes,
            // A real UUID per line: `ingredientId` is `z.uuid()` on the shipped contract, and this tier
            // exists to be judged by that contract rather than by a placeholder that merely looks like an id.
            ingredients: outcome.recipe.ingredients.map((line) =>
                toImportedIngredientLine(line, { id: randomUUID(), name: line.name }),
            ),
            steps: outcome.recipe.steps.map((instruction) => ({ instruction })),
            source: {
                sourceType: 'imported_public',
                sourceUrl: book.sourceUrl,
                sourceAttribution: book.attribution,
            },
        },
    };
}

describe('a historical measure, from prose to the shipped contract', () => {
    it('reaches a create body the REAL createRecipeRequestSchema accepts', () => {
        const { body } = candidateFor('international-jewish');

        const parsed = createRecipeRequestSchema.safeParse(body);

        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(parsed.success).toBe(true);
    });

    /**
     * ⛔ THE HEADLINE, at the only boundary that matters: the same prose under two books produces two
     * DIFFERENT storable numbers, and BOTH are accepted by the contract. An imperial gill restates to a
     * value with a rounding tail, so this is also the case that proves the 3-decimal storage scale is
     * applied before the wire rather than left to the column.
     */
    it('accepts BOTH the American and the British reading of the same gill', () => {
        const american = candidateFor('international-jewish');
        const british = candidateFor('jewish-manual');

        expect(createRecipeRequestSchema.safeParse(american.body).success).toBe(true);
        expect(createRecipeRequestSchema.safeParse(british.body).success).toBe(true);

        const americanMilk = american.body.ingredients.find((line) => line.name.includes('milk'));
        const britishMilk = british.body.ingredients.find((line) => line.name.includes('milk'));

        expect(americanMilk?.quantity).toEqual({ kind: 'exact', value: 0.5 });
        expect(britishMilk?.quantity).toEqual({ kind: 'exact', value: 0.6 });
        expect(americanMilk?.unit).toBe('cup');
        expect(britishMilk?.unit).toBe('cup');
    });

    it('teaches the real parser every historical measure in the block, so none is dropped', () => {
        const { lines } = candidateFor('international-jewish');

        expect(
            lines
                .map((line) => line.unitConversion?.equivalence.unit)
                .filter(Boolean)
                .sort(),
        ).toEqual(['gill', 'saltspoon', 'wineglass']);
    });

    /** R35 — the book's own words reach the fields a human and the verification gate read. */
    it('keeps the source’s own measure in the display text and the source line', () => {
        const { body } = candidateFor('international-jewish');
        const milk = body.ingredients.find((line) => line.name.includes('milk'));

        expect(milk?.notes).toContain('gill');
        expect(milk?.sourceLine).toContain('gill');
        // …while the structured unit is the restated one, which is the distinction R35 exists to make.
        expect(milk?.unit).toBe('cup');
    });

    /**
     * R34 — the citation and the measure system travel with the value out of the mapper, so a reader of
     * the persisted recipe is told which authority sized the measure rather than being handed a number.
     */
    it('discloses the authority in the description the recipe is created with', () => {
        const { body } = candidateFor('jewish-manual');

        expect(body.description).toContain('British imperial');
        // ⚠️ REWRITTEN, not repaired. This asserted `NIST Handbook 44` — the citation the hand-written
        // pint-and-gallon table carried before `standardUnits.ts` took the gill from UCUM. Editing it to
        // whatever string happens to render now would leave a test that passes and proves nothing, so it
        // asserts the distinction the new code actually makes: a gill is STANDARDISED and cites the
        // standard, a saltspoon is a household CONVENTION and says so. One book's description carries
        // both, so a reader is never told a convention was a standard.
        expect(body.description).toContain('UCUM (gill)');
        expect(body.description).toContain('a household convention (1 saltspoonful = ¼ teaspoonful)');
        // ⚠️ And the lengthened description still passes the contract's own cap. A recipe drawing on
        // several authorities carries one sentence each, so the ceiling is reachable — which is exactly
        // why it is asserted against the shipped schema and not eyeballed.
        expect(createRecipeRequestSchema.safeParse(body).success).toBe(true);
    });
});
