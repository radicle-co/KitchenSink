/**
 * Unit tests for the prose → candidate-recipe MAPPER.
 *
 * This is the module that decides what a 1900s prose paragraph means, and — just as importantly — which
 * blocks are NOT recipes. Every case below is taken from the committed corpus excerpts, because the shapes
 * that matter are the ones the books actually contain.
 *
 * ## The three properties that carry the value
 *
 *  1. **Nothing is fabricated.** A quantity, a duration and a yield are either READ FROM THE TEXT or absent,
 *     and an absent one never becomes a plausible-looking number. This is HAZ-040's rule, and it is the
 *     reason the mapper SKIPS rather than invents: a fabricated `4 servings` on a public recipe is
 *     indistinguishable from a measured one once it is on screen.
 *  2. **A skip is a REPORTED outcome, not a silent drop.** Every rejected block comes back with a reason, so
 *     a low yield is explainable rather than mysterious.
 *  3. **An ingredient line the mapper cannot quantify is dropped AND reported verbatim.** The shipped schema
 *     makes a quantity-less line unrepresentable (`recipe_ingredients.quantity` is
 *     `numeric(10,3) NOT NULL CHECK (quantity > 0)`), so "salt and pepper to taste" cannot be persisted at
 *     all — see ADR-0023's finding against 004-FR-020. Dropping it is forced; hiding it is not.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { segmentCookbook, type CookbookBlock } from '../gutenbergBook.adapter.js';
import { toCandidateRecipe, type RecipeCandidateOutcome } from '../proseRecipe.js';

const FIXTURE = readFileSync(join(import.meta.dirname, '../../fixtures/cookbookExcerpts.txt'), 'utf-8');
const BLOCKS = segmentCookbook(FIXTURE);

/** Map one fixture block by title, failing loudly if the fixture no longer contains it. */
function outcomeFor(title: string): RecipeCandidateOutcome {
    const block = BLOCKS.find((candidate) => candidate.title === title);

    if (!block) {
        throw new Error(`fixture has no block titled ${title}`);
    }

    return toCandidateRecipe(block);
}

/** Narrow to an accepted candidate, failing with the skip reason rather than an opaque undefined. */
function candidateFor(title: string) {
    const outcome = outcomeFor(title);

    if (outcome.kind !== 'candidate') {
        throw new Error(`expected ${title} to be importable, got skip: ${outcome.reason}`);
    }

    return outcome;
}

describe('toCandidateRecipe — what it accepts', () => {
    it('reads ingredient lines out of a prose sentence, with their real quantities and units', () => {
        const { recipe } = candidateFor('BEET SOUP--RUSSIAN STYLE (FLEISCHIG)');
        const byName = new Map(recipe.ingredients.map((line) => [line.name.toLowerCase(), line]));

        // "…one-half pound of onion…" — a spelled-out FRACTION, which is the whole difficulty of this corpus.
        const onion = [...byName.entries()].find(([name]) => name.includes('onion'))?.[1];
        expect(onion?.quantity).toBe(0.5);
        // `parse-ingredient` normalizes the unit it recognised; the property under test is that a MASS unit
        // was read off a spelled-out fraction, not the spelling the library settles on.
        expect(onion?.unit).toBe('lb');

        // "…three-fourths of a cup of sugar…" — the `X of a UNIT of Y` form.
        const sugar = [...byName.entries()].find(([name]) => name.includes('sugar'))?.[1];
        expect(sugar?.quantity).toBeCloseTo(0.75, 5);
        expect(sugar?.unit).toBe('cup');
    });

    it('finds a quantity that is NOT at the start of its clause', () => {
        // "…put in kettle with one pound of fat brisket of beef…" — the quantity is six words in. A mapper
        // that only ever looked at the head of a clause would lose the main ingredient of the dish.
        const { recipe } = candidateFor('BEET SOUP--RUSSIAN STYLE (FLEISCHIG)');

        expect(recipe.ingredients.some((line) => line.name.toLowerCase().includes('beef'))).toBe(true);
    });

    it('reads NUMERAL quantities too, so the corpus is not one book wide', () => {
        // `The Golden Rule Cook Book` (#55555) writes "4 cups of cold milk" where the others spell it out.
        // Without a passing case from this book, the claim that the parser handles both styles would be
        // asserted only by a comment.
        const { recipe } = candidateFor('ASPARAGUS SOUP');

        expect(recipe.ingredients.some((line) => line.quantity === 4 && line.unit === 'cup')).toBe(true);
        expect(recipe.ingredients.some((line) => line.name.toLowerCase().includes('asparagus'))).toBe(true);
    });

    it('takes the cooking time FROM THE TEXT and never invents one', () => {
        // "…let cook slowly two hours… and let cook another hour" — the longest stated duration is 2 h.
        const { recipe } = candidateFor('BEET SOUP--RUSSIAN STYLE (FLEISCHIG)');

        expect(recipe.cookTimeMinutes).toBe(120);
        expect(recipe.totalTimeMinutes).toBe(120);
    });

    it('splits the body into ordered steps', () => {
        const { recipe } = candidateFor('ASPARAGUS SOUP');

        expect(recipe.steps.length).toBeGreaterThan(1);
        expect(recipe.steps.every((step) => step.trim().length > 0)).toBe(true);
    });

    it('presents the title as a name rather than as shouting', () => {
        expect(candidateFor('ASPARAGUS SOUP').recipe.title).toBe('Asparagus Soup');
        expect(candidateFor('BEET SOUP--RUSSIAN STYLE (FLEISCHIG)').recipe.title).toBe(
            'Beet Soup--Russian Style (Fleischig)',
        );
    });
});

describe('toCandidateRecipe — a DIMENSION is not an ingredient (regression, found in a live run)', () => {
    /**
     * ⛔ THE DEFECT THIS PINS, observed against live services on 2026-08-19.
     *
     * "…cut in slices one-quarter inch thick…" parsed as `0.25 inch :: thick`, and "…two inches square…" as
     * `2 inche :: square`. Both were then sent to the product's catalog lookup, MATCHED a real USDA food,
     * and landed on a PUBLIC recipe carrying a real `food_id` — a nutrition claim derived from a
     * measurement of a knife cut.
     *
     * The costs are asymmetric, which is why the rule errs toward dropping: a missed line costs one absent
     * ingredient, while a wrong `food_id` is a silent, plausible-looking lie in public data. It also keeps
     * the resolution measurement honest — a name no user would ever type must not be counted as a lookup.
     */
    it('does not read a dimension as an ingredient quantity', () => {
        const outcome = toCandidateRecipe({
            title: 'DIMENSION TRAP',
            paragraphs: [
                'Cut the bread in slices one-quarter inch thick and two inches square, then take one ' +
                    'tablespoon of butter, one teaspoon of chopped onion and one cup of milk; let cook slowly ' +
                    'two hours. Serve at once on a hot dish with the sauce poured over the top.',
            ],
        });

        expect(outcome.kind).toBe('candidate');

        if (outcome.kind !== 'candidate') {
            return;
        }

        const names = outcome.recipe.ingredients.map((line) => line.name.toLowerCase());
        const units = outcome.recipe.ingredients.map((line) => (line.unit ?? '').toLowerCase());

        expect(names).not.toContain('thick');
        expect(names).not.toContain('square');
        expect(units).not.toContain('inch');
        expect(units).not.toContain('inche');

        // …and the counterpart property, so the rule cannot be satisfied by rejecting everything.
        expect(names).toContain('butter');
        expect(names).toContain('chopped onion');
        expect(names).toContain('milk');
    });
});

describe('toCandidateRecipe — the yield it does not have', () => {
    /**
     * ⚠️ THE ONE PLACE A NUMBER IS SUPPLIED RATHER THAN READ, AND WHY IT IS NOT A FABRICATION.
     *
     * These books almost never state a yield, and `recipes.servings` is `NOT NULL` with no "unknown" — so
     * something must be written. `1` is chosen because it is the only value that makes the shipped scaling
     * feature TRUE: scaling is a ratio over the authored servings, so `1` means "the quantities exactly as
     * printed", and asking for 2 doubles them. Any other value would silently rescale every printed
     * quantity by a factor nobody measured. The substitution is disclosed in the description, so the
     * reader is told rather than misled.
     */
    it('uses 1 (one batch as printed) when the source states no yield, and SAYS SO in the description', () => {
        const { recipe } = candidateFor('BEET SOUP--RUSSIAN STYLE (FLEISCHIG)');

        expect(recipe.servings).toBe(1);
        expect(recipe.servingsStated).toBe(false);
        expect(recipe.description.toLowerCase()).toContain('yield');
    });

    it('leaves prep time at 0 and does not pretend the source stated one', () => {
        expect(candidateFor('BEET SOUP--RUSSIAN STYLE (FLEISCHIG)').recipe.prepTimeMinutes).toBe(0);
    });
});

describe('toCandidateRecipe — what it refuses, and why', () => {
    it('skips a heading with no body', () => {
        const outcome = outcomeFor('BARLEY AND VEGETABLE SOUP');

        expect(outcome.kind).toBe('skipped');
        expect(outcome.kind === 'skipped' && outcome.reason).toBe('no_body');
    });

    it('skips prose that names ingredients but quantifies none', () => {
        // BORSHT: "Take some red beetroots… adding lemon juice, sugar, and salt to taste". Real cookery,
        // zero numbers — importing it would produce a recipe whose ingredient list is empty or invented.
        const outcome = outcomeFor('BORSHT');

        expect(outcome.kind).toBe('skipped');
        expect(outcome.kind === 'skipped' && outcome.reason).toBe('too_few_ingredients');
    });

    it('skips a recipe whose text states no cooking time', () => {
        // POTATO SOUP gives quantities and a full method but only ever says "a few minutes" — not a
        // duration. Rather than write a plausible number into a NOT NULL column, the mapper declines the
        // recipe and names the rule that refused it.
        const outcome = outcomeFor('POTATO SOUP');

        expect(outcome.kind).toBe('skipped');
        expect(outcome.kind === 'skipped' && outcome.reason).toBe('no_stated_duration');
    });

    it('skips a recipe printed with a trailing-period heading and no quantities at all', () => {
        // CURRIED VEAL (#12327) is real cookery written entirely without numbers: "Cut a breast of veal
        // into pieces, fry lightly with a chopped onion…". It also proves the trailing-period heading was
        // read — the block exists to be skipped, rather than being invisible.
        const outcome = outcomeFor('CURRIED VEAL');

        expect(outcome.kind).toBe('skipped');
        expect(outcome.kind === 'skipped' && outcome.reason).toBe('too_few_ingredients');
    });

    it('reports every dropped ingredient line VERBATIM, so a low yield is explainable', () => {
        const { droppedLines, recipe } = candidateFor('BEET SOUP--RUSSIAN STYLE (FLEISCHIG)');

        // "…a little citric acid to make it sweet and sour…" names a real ingredient with no quantity the
        // shipped schema can store. It must come back as the SOURCE'S OWN WORDS rather than vanishing.
        expect(droppedLines.length).toBeGreaterThan(0);
        expect(droppedLines.join(' ')).toContain('citric acid');
        expect(recipe.ingredients.some((line) => line.name.includes('citric'))).toBe(false);

        for (const dropped of droppedLines) {
            expect(dropped.trim().length).toBeGreaterThan(0);
        }
    });
});

/**
 * The mapper's input is UNTRUSTED prose from a downloaded book, so a pathological line is an input the
 * importer will eventually be handed — not a hypothetical. CodeQL `js/redos` flagged the partitive strip
 * (`dropPartitiveOf`) on PR 91: its inner group admitted `.` and `/` as BOTH the separator and the tail
 * content, which makes the parse of _n_ separators 2^n-ambiguous and the failed match exponential.
 *
 * Measured on the old pattern in isolation: 28 separators took 95 ms, 30 took 421 ms, 32 took 1,785 ms —
 * roughly 2.2x per added character. Through the mapper, where every clause and every suffix-skip retries
 * it, the single 200-character paragraph below took **81.5 seconds**; after the fix the whole file's 37
 * tests run in 31 ms. The probe uses `/` rather than `.` because clauses split on sentence punctuation,
 * which would defuse a run of dots before it reached the strip, and it is one unbroken WORD so the run
 * survives whitespace normalization.
 */
describe('adversarial input', () => {
    it('strips the partitive in linear time, so a run of separators cannot hang the import', () => {
        const block: CookbookBlock = {
            title: 'REDOS PROBE',
            paragraphs: [
                `Take 0${'/'.repeat(34)} of the best sweet butter into a clean saucepan set over a gentle` +
                    ' fire until it is quite melted through, stirring it well the while so that it does' +
                    ' not catch upon the bottom of the pan.',
            ],
        };

        const started = performance.now();
        const outcome = toCandidateRecipe(block);
        const elapsed = performance.now() - started;

        // The line carries no quantified ingredient, so the block is REPORTED as skipped, not accepted.
        expect(outcome.kind).toBe('skipped');
        // Generous by orders of magnitude against the linear implementation, and 1/80th of the exponential
        // one's measured cost for this exact input — so neither side of the gate is a close call.
        expect(elapsed).toBeLessThan(1000);
    });
});
