/**
 * Split a measurement phrase into the parts that SUM and the parts that only restate it.
 *
 * DESIGN PATTERN: pure Specification over one string. No I/O, no clock, total on every input.
 *
 * ## ⛔ WHY THIS IS NOT `normalizeQuantity`'s JOB
 *
 * `normalizeQuantity` reads the LEADING quantity phrase, which is correct for what it does and is why it
 * cannot see a second one. Measured 2026-08-23, `parseIngredientLine` therefore put "and 1 tablespoon" and
 * "(about 4 cups)" into the FOOD NAME with `reviewReasons` empty — a name carrying a measurement matches no
 * catalog row, and an empty review reason means nobody is asked to correct it. This module is the missing
 * step BEFORE that one: it decides where a measurement's parts are, and hands each part over unchanged.
 *
 * ## ⛔ THE INVERSION THAT MUST NEVER HAPPEN
 *
 * Three shapes look alike and mean different things:
 *
 *  - **additive** — `2 cups and 1 tablespoon` is one amount plus another.
 *  - **equivalent** — `1 pound (about 4 cups)` is a single amount stated twice, for the cook's convenience.
 *  - **container and net** — `1 (14.5 ounce) can` is one container and what it holds.
 *
 * Only the first sums. Reading an equivalent as additive DOUBLES the ingredient, silently, and nothing
 * downstream can detect it — so the joining rule is deliberately narrow: a conjunction joins, a parenthetical
 * never does. When in doubt this module keeps a phrase whole, because an unsplit measurement is visible to
 * the caller while a wrongly-split one is not.
 *
 * ⚠️ It does NOT parse numbers. Each part comes out as the phrase the line wrote, for `normalizeQuantity` to
 * read — which owns exact rational arithmetic, unit normalisation and number words, and is better at all
 * three than anything that guesses.
 */

/** A measurement phrase, divided by what may be added together. */
export interface SplitMeasurement {
    /**
     * The parts that make up the amount, in the order written. More than one means they ADD.
     * A single element is the ordinary case; an empty list means the phrase said nothing at all.
     */
    readonly summed: readonly string[];
    /**
     * Amounts the phrase states again in other terms, or a container's contents. Never summed, and kept
     * rather than dropped so a later reader can prefer the net weight over the container count.
     */
    readonly restated: readonly string[];
}

/**
 * A conjunction joining two measurements, as opposed to one inside an amount.
 *
 * ⛔ Requires a DIGIT after the conjunction. `one and a half cups` and `two and a half pounds` both carry
 * "and" inside the amount, and a bare word match would cut them in half — reporting a fifth of a pound as
 * two ingredients. Requiring the next token to start a new number is what separates "2 cups and 1 tablespoon"
 * from "one and a half cups", without needing to know which number words exist.
 */
const JOINS = /\s*,?\s*\b(?:and|plus)\b\s+(?=[\d¼-¾])/giu;

/** A parenthesised restatement, closed or running to the end of the phrase. */
const PARENTHETICAL = /\s*\(([^)]*)\)?\s*/gu;

/**
 * Divide a measurement phrase into its addable parts and its restatements.
 *
 * @param measurement - The measurement's own words, exactly as the line wrote them.
 * @returns The parts that sum, and the parts that only restate. Both may be empty; neither is ever null.
 */
export function splitMeasurement(measurement: string): SplitMeasurement {
    const restated: string[] = [];

    // Lift the parentheticals out first, so a conjunction INSIDE one cannot be mistaken for a join between
    // measurements — "(about 4 cups and a bit)" restates one amount, however it is worded.
    const withoutRestatements = measurement.replace(PARENTHETICAL, (_match, inner: string | undefined) => {
        const text = (inner ?? '').trim();

        if (text !== '') {
            restated.push(text);
        }

        return ' ';
    });

    const summed = withoutRestatements
        .split(JOINS)
        .map((part) => part.trim())
        .filter((part) => part !== '');

    return { summed, restated };
}
