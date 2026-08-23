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

import { COOKBOOKS, type Cookbook } from '../cookbooks.js';
import { segmentCookbook, type CookbookBlock } from '../gutenbergBook.adapter.js';
import { toCandidateRecipe, type CandidateIngredient, type RecipeCandidateOutcome } from '../proseRecipe.js';

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
        // ⚠️ REWRITTEN for U7's quantity value object — the asserted amount is unchanged. `quantity` was
        // `number | null`; it is now `exact | range | absent`, because `number | null` had nowhere to put
        // the upper bound of a stated range (KTD-6, R36).
        expect(onion?.quantity).toEqual({ kind: 'exact', value: 0.5 });
        // `parse-ingredient` normalizes the unit it recognised; the property under test is that a MASS unit
        // was read off a spelled-out fraction, not the spelling the library settles on.
        expect(onion?.unit).toBe('lb');

        // "…three-fourths of a cup of sugar…" — the `X of a UNIT of Y` form.
        const sugar = [...byName.entries()].find(([name]) => name.includes('sugar'))?.[1];
        expect(sugar?.quantity).toEqual({ kind: 'exact', value: 0.75 });
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

        expect(
            recipe.ingredients.some(
                (line) => line.quantity.kind === 'exact' && line.quantity.value === 4 && line.unit === 'cup',
            ),
        ).toBe(true);
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

/**
 * U7 (R29, R39) — the clause splitter must not cut a quantity in half, and a clause whose own parse is
 * value-corrupting must not be re-read into something that merely looks clean.
 */
describe('toCandidateRecipe — the clause splitter and the quantity it must not break (R29)', () => {
    /**
     * ⛔ THE DEFECT THIS PINS, measured 2026-08-21 on the committed corpus slice.
     *
     * `CLAUSE_SPLIT` breaks on a bare ` and `, and it ran BEFORE the quantity normalizer — so
     * "One and one-half cups of confectioner's sugar" was cut into "One" and
     * "one-half cups of confectioner's sugar", and the recipe was published calling for **0.5 cups**:
     * one third of the stated amount, with `needsReview: false`.
     *
     * `parseIngredientLine` always read the phrase correctly (pinned in the golden corpus). The loss was
     * entirely in the split, which is why the fix belongs here and not in the parser.
     */
    it('keeps "One and one-half" whole rather than publishing a third of the stated quantity', () => {
        const { recipe } = candidateFor('GREEN TREE LAYER CAKE AND ICING');
        const sugar = recipe.ingredients.find((line) => line.name.toLowerCase().includes("confectioner's"));

        expect(sugar).toBeDefined();
        expect(sugar?.quantity).toEqual({ kind: 'exact', value: 1.5 });
        expect(sugar?.unit).toBe('cup');
    });

    /**
     * The COUNTERPART property, without which the fix above could be "achieved" by never splitting on
     * `and` at all. `CLAUSE_SPLIT`'s bare-` and ` alternative is load-bearing and documented: these books
     * chain several ingredients into one punctuation-free clause, and losing the split would import a
     * third of each recipe's ingredients.
     */
    it('still splits a bare "and" that chains two ingredients', () => {
        const { recipe } = candidateFor('BEET SOUP--RUSSIAN STYLE (FLEISCHIG)');
        const names = recipe.ingredients.map((line) => line.name.toLowerCase());

        // "Cut one large beet AND one-half pound of onion in thick pieces AND put in kettle with one
        // pound of fat brisket of beef" — three ingredients in one breath.
        expect(names.some((name) => name.includes('beet'))).toBe(true);
        expect(names.some((name) => name.includes('onion'))).toBe(true);
        expect(names.some((name) => name.includes('beef'))).toBe(true);
    });

    it('splits an "and" whose neighbours are numbers but which joins no quantity phrase', () => {
        // "two teaspoons of baking-powder and three and one-half cups of flour" — the FIRST `and` joins
        // two ingredients and must split; the second belongs to the quantity and must not.
        const outcome = toCandidateRecipe({
            title: 'AND TRAP',
            paragraphs: [
                'Rub one cup of butter and two cups of sugar to a cream, add four eggs, one cup of milk, ' +
                    'two teaspoons of baking-powder and three and one-half cups of flour. Beat the whole ' +
                    'until it is light and perfectly smooth, taking care not to let it stand. Bake in ' +
                    'layer tins for three-quarters of an hour and serve while fresh.',
            ],
        });

        expect(outcome.kind).toBe('candidate');

        if (outcome.kind !== 'candidate') {
            return;
        }

        const byName = new Map(outcome.recipe.ingredients.map((line) => [line.name.toLowerCase(), line]));

        expect(byName.get('baking-powder')?.quantity).toEqual({ kind: 'exact', value: 2 });
        expect(byName.get('flour')?.quantity).toEqual({ kind: 'exact', value: 3.5 });
    });
});

describe('toCandidateRecipe — a value-corrupting parse is dropped, never re-read (R39)', () => {
    /**
     * ⛔ THE DEFECT THIS PINS, measured 2026-08-21.
     *
     * `ingredientInClause` tries successively shorter SUFFIXES of a clause and keeps the first that
     * yields a quantity and a unit. For "three to two cups of flour" the whole clause parses to
     * `quantity_bounds_inverted` and is correctly refused — but the suffix "two cups of flour" then
     * parses CLEANLY to exactly 2, with `needsReview: false`. The lower bound of an inverted range was
     * about to be published as a certain quantity, having been laundered by dropping a word.
     *
     * So the gate is on the WHOLE clause's parse, not on the suffix that happens to survive: a clause
     * whose own reading misstates a value is not an ingredient at any length.
     */
    it('refuses a clause whose full parse states bounds that disagree, rather than keeping a suffix', () => {
        const outcome = toCandidateRecipe({
            title: 'INVERTED RANGE',
            paragraphs: [
                'Take three to two cups of flour, one cup of milk, two teaspoons of baking-powder and ' +
                    'one cup of sugar. Mix all of these well together in a large bowl until the batter ' +
                    'is smooth and creamy, then turn it into a buttered tin. Bake for three-quarters of ' +
                    'an hour in a slow oven and set aside to cool before serving.',
            ],
        });

        expect(outcome.kind).toBe('candidate');

        if (outcome.kind !== 'candidate') {
            return;
        }

        expect(outcome.recipe.ingredients.some((line) => line.name.toLowerCase().includes('flour'))).toBe(false);
        expect(outcome.droppedLines.join(' ')).toContain('three to two cups of flour');

        // The counterpart, so the rule cannot be satisfied by refusing the whole block.
        expect(outcome.recipe.ingredients.some((line) => line.name.toLowerCase().includes('milk'))).toBe(true);
    });

    it('carries a stated RANGE through to the candidate rather than narrowing it (R36)', () => {
        const outcome = toCandidateRecipe({
            title: 'STATED RANGE',
            paragraphs: [
                'Take two to three cups of flour, one cup of milk, two teaspoons of baking-powder and one ' +
                    'cup of sugar. Mix all of these well together in a large bowl until the batter is ' +
                    'smooth and creamy, then turn it into a buttered tin. Bake for three-quarters of an ' +
                    'hour in a slow oven and set aside to cool before serving.',
            ],
        });

        expect(outcome.kind).toBe('candidate');

        if (outcome.kind !== 'candidate') {
            return;
        }

        const flour = outcome.recipe.ingredients.find((line) => line.name.toLowerCase().includes('flour'));

        expect(flour?.quantity).toEqual({ kind: 'range', low: 2, high: 3 });
        expect(flour?.unit).toBe('cup');
    });
});

/**
 * R32–R35 — historical units, resolved from the SOURCE BOOK and disclosed to the reader.
 *
 * ⚠️ The prose below is written for the test rather than lifted from a fixture, because the committed
 * corpus excerpts contain no gill or wineglassful and the golden corpus carries a VERBATIM rule that
 * forbids inventing one. What these cases prove is the MAPPER's behaviour, never the book's text.
 */
describe('toCandidateRecipe, on historical units', () => {
    const HISTORICAL: CookbookBlock = {
        title: 'A SAUCE FOR PUDDING',
        paragraphs: [
            'Take one gill of milk, one wineglassful of sherry and two saltspoons of salt, and put them ' +
                'together in a small saucepan over a gentle fire. Stir the mixture without ceasing until it ' +
                'is quite smooth and begins to thicken, then draw it to the side of the stove. Let it cook ' +
                'slowly half an hour and serve it very hot with a plain boiled pudding.',
        ],
    };

    const PLAIN: CookbookBlock = {
        title: 'A PLAIN CAKE',
        paragraphs: [
            'Take two cups of flour, one cup of milk and two teaspoons of baking-powder, and mix them well ' +
                'together in a large bowl until the batter is smooth and creamy. Turn it into a buttered tin ' +
                'and bake it half an hour in a slow oven, then set it aside on a rack to cool completely.',
        ],
    };

    /** Look one ingredient up by name, failing loudly rather than asserting against `undefined`. */
    function lineFor(outcome: RecipeCandidateOutcome, name: string): CandidateIngredient {
        if (outcome.kind !== 'candidate') {
            throw new Error(`expected a candidate, got a skip: ${outcome.reason}`);
        }

        const line = outcome.recipe.ingredients.find((candidate) => candidate.name.toLowerCase().includes(name));

        if (line === undefined) {
            const seen = outcome.recipe.ingredients.map((candidate) => candidate.name).join(', ');

            throw new Error(`no ingredient matching "${name}"; the mapper read: ${seen}`);
        }

        return line;
    }

    it('restates a gill from an AMERICAN book into a unit the food catalog can weigh', () => {
        const milk = lineFor(toCandidateRecipe(HISTORICAL, COOKBOOKS['international-jewish']), 'milk');

        expect(milk.unit).toBe('cup');
        expect(milk.quantity).toEqual({ kind: 'exact', value: 0.5 });
    });

    /**
     * ⛔ THE HEADLINE OF R33, at the pipeline level: the SAME prose, two books, two numbers. If this ever
     * reports one value for both, a whole corpus is being converted with another book's factors.
     */
    it('restates the SAME gill differently for The Jewish Manual, because it is a British book', () => {
        const american = lineFor(toCandidateRecipe(HISTORICAL, COOKBOOKS['international-jewish']), 'milk');
        const british = lineFor(toCandidateRecipe(HISTORICAL, COOKBOOKS['jewish-manual']), 'milk');

        expect(american.quantity).toEqual({ kind: 'exact', value: 0.5 });
        expect(british.quantity).toEqual({ kind: 'exact', value: 0.6 });
        expect(american.unitConversion?.equivalence.measureSystem).toBe('us-customary');
        expect(british.unitConversion?.equivalence.measureSystem).toBe('british-imperial');
    });

    it('marks the converted line with its citation and keeps the amount the book PRINTED (R34, R35)', () => {
        const milk = lineFor(toCandidateRecipe(HISTORICAL, COOKBOOKS['international-jewish']), 'milk');

        expect(milk.unitConversion?.stated).toEqual({ quantity: { kind: 'exact', value: 1 }, unit: 'gill' });
        expect(milk.unitConversion?.equivalence.citation).toContain('12350');
        expect(milk.unitConversion?.equivalence.source).toBe('source-book-table');
        // The source's own UNIT survives on the line even after the structured values are restated — it is
        // what `toImportedIngredientLine` sends as `notes` and `sourceLine`.
        //
        // ⚠️ `raw` is the suffix the scan handed the parser, so its NUMBER is already normalized
        // ("one" -> "1"). That predates this unit and is asserted here as found, not as desired:
        // `importedIngredientLine.ts` documents `sourceLine` as the clause "verbatim", and it is not
        // quite. Flagged for U11, whose gate keys its verdict on that field.
        expect(milk.raw).toContain('gill of milk');
    });

    /** ⛔ Presence IS the disclosure — a directly-stated metric line must carry no marker at all. */
    it('leaves a directly-stated metric line unmarked and untouched', () => {
        const flour = lineFor(toCandidateRecipe(PLAIN, COOKBOOKS['international-jewish']), 'flour');

        expect(flour.unitConversion).toBeUndefined();
        expect(flour.unit).toBe('cup');
        expect(flour.quantity).toEqual({ kind: 'exact', value: 2 });
    });

    /**
     * ⛔ An unconvertible historical line is KEPT, not dropped. `one gill of milk` is a real ingredient
     * with a stated amount; discarding it to protect a nutrition nicety inverts this module's own
     * asymmetric-cost rule, which is about never asserting a WRONG number — not about refusing a right one.
     */
    it('keeps the line unconverted when no book is supplied at all', () => {
        const milk = lineFor(toCandidateRecipe(HISTORICAL), 'milk');

        expect(milk.unit).toBe('gill');
        expect(milk.quantity).toEqual({ kind: 'exact', value: 1 });
        expect(milk.unitConversion).toBeUndefined();
    });

    it('keeps the line unconverted when the book’s measure system is unestablished (R33)', () => {
        const placeless: Cookbook = {
            ...COOKBOOKS['international-jewish'],
            measures: {
                origin: { kind: 'unestablished', why: 'A test fixture standing in for a book nobody has placed.' },
                table: { kind: 'not-transcribed', why: 'A test fixture; no table has been read.' },
            },
        };
        const milk = lineFor(toCandidateRecipe(HISTORICAL, placeless), 'milk');

        expect(milk.unit).toBe('gill');
        expect(milk.unitConversion).toBeUndefined();
    });

    /**
     * R35's reader-facing half. The description already exists to disclose what the source did NOT state
     * (its yield, its prep time); a converted measure is the same kind of fact, and it is disclosed in the
     * same place rather than leaving a reader to wonder why a book from 1919 calls for half a cup.
     */
    it('discloses the conversion in the recipe description, naming the system and the authority', () => {
        const outcome = toCandidateRecipe(HISTORICAL, COOKBOOKS['international-jewish']);

        if (outcome.kind !== 'candidate') {
            throw new Error(`expected a candidate, got a skip: ${outcome.reason}`);
        }

        expect(outcome.recipe.description).toContain('gill');
        expect(outcome.recipe.description).toContain('US customary');
        expect(outcome.recipe.description).toContain('TABLE OF WEIGHTS AND MEASURES');
    });

    it('says nothing about measures in a description when nothing was converted', () => {
        const outcome = toCandidateRecipe(PLAIN, COOKBOOKS['international-jewish']);

        if (outcome.kind !== 'candidate') {
            throw new Error(`expected a candidate, got a skip: ${outcome.reason}`);
        }

        expect(outcome.recipe.description).not.toContain('measure');
        expect(outcome.recipe.description).not.toContain('customary');
    });
});
