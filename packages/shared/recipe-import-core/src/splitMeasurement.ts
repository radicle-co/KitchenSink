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
 * The ONE definition of a conjunction that joins two measurements, as opposed to one inside an amount.
 *
 * ⛔ EXPORTED SO IT IS NOT WRITTEN TWICE. `ingredientLine.ts` needs the same rule, anchored differently, and
 * a second copy of it lost this lookahead within an hour of being written — re-creating the shipped defect
 * where "One and one-half cups" was cut into "One" and "one-half cups" and published as 0.5 cups, a third of
 * the stated amount, with `needsReview: false`.
 *
 * Not on the package barrel: a regex there would break the all-exports-are-functions control, and no consumer
 * outside this package has a use for it.
 *
 * ⛔ Requires a DIGIT after the conjunction. `one and a half cups` and `two and a half pounds` both carry
 * "and" inside the amount, and a bare word match would cut them in half — reporting a fifth of a pound as
 * two ingredients. Requiring the next token to start a new number is what separates "2 cups and 1 tablespoon"
 * from "one and a half cups", without needing to know which number words exist.
 */
export const MEASUREMENT_JOIN_SOURCE = '(?:\\b(?:and|plus)\\b|&|\\+)\\s+(?=[\\d¼-¾])';

// ⛔ The join alone, with NO separator prefix. It used to be prefixed `\s*,?\s*` to absorb the `, ` in
// "2 cups, and 1 tablespoon" — the polynomial-ReDoS shape: two quantifiers that can consume the SAME
// whitespace, retried at every start position. It did not finish 4,000 spaces in 120 SECONDS.
// ⚠️ Collapsing them to ONE character class was NOT enough, and only measuring showed it: a single
// greedy quantifier followed by a match that FAILS still tries every length at every start, so it stayed
// quadratic — 168ms at 20,000 spaces. The separator is stripped per part instead, by a loop that cannot
// backtrack at all.
const JOINS = new RegExp(MEASUREMENT_JOIN_SOURCE, 'giu');

/** Runs of whitespace, collapsed once a parenthetical is lifted out. One quantifier, so linear. */
const WHITESPACE_RUN = /\s+/gu;

/**
 * Drop the separator a join leaves behind — `"2 cups, "` becomes `"2 cups"`.
 *
 * ⛔ Deliberately NOT a regex. Even an end-anchored `[\s,]+$` is scanned from every start position, which
 * reintroduces exactly the quadratic behaviour this module was fixed for. A loop over the tail is linear,
 * total, and obvious.
 *
 * @param part - One part of a split measurement, already whitespace-collapsed.
 * @returns The part without trailing spaces or commas. Pure.
 */
function withoutTrailingSeparator(part: string): string {
    let end = part.length;

    while (end > 0 && (part[end - 1] === ',' || part[end - 1] === ' ')) {
        end -= 1;
    }

    return part.slice(0, end);
}

/**
 * A parenthesised restatement, closed or running to the end of the phrase.
 *
 * ⛔ NO surrounding whitespace quantifiers. They used to bracket this group, and two unanchored `\s*`
 * either side of a group that can FAIL to match is the polynomial-ReDoS shape CodeQL flags: measured
 * 1.2ms at 2,000 spaces rising to 66.6ms at 16,000 — doubling the input quadrupled the time.
 *
 * ⚠️ Dropping them is NOT free, and the first attempt got this wrong. Lifting a parenthetical out of
 * "1 (14.5 ounce) can" leaves a DOUBLED INTERIOR space that trimming cannot reach, because it is at
 * neither end of the part. {@link splitMeasurement} collapses whitespace runs before splitting for
 * exactly that reason.
 */
const PARENTHETICAL = /\(([^)]*)\)?/gu;

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
        // ⚠️ Collapse BEFORE splitting. Lifting the parenthetical out of "1 (14.5 ounce) can" leaves
        // "1  can" with a DOUBLED INTERIOR space, which trimming cannot reach because it is at neither
        // end — the assumption that it could was wrong, and a test caught it.
        .replace(WHITESPACE_RUN, ' ')
        .split(JOINS)
        .map((part) => withoutTrailingSeparator(part.trim()))
        .filter((part) => part !== '');

    return { summed, restated };
}
