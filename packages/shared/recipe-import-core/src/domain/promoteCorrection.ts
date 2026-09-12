/**
 * @module promoteCorrection — a COOK's corrected facts, as a {@link ParsedLine} (plan U22, phase 4 / KTD-15).
 *
 * DESIGN PATTERN: **Adapter**, the third sibling of `promoteCrfReading` and `promoteLlmParse` and shaped
 * identically on purpose — same `(reading, sourceLine) => ParsedLine` signature — so that a fact read by an
 * engine and a fact asserted by a person differ only in WHO said it, never in how it became a value.
 *
 * It is its own module rather than a step inside `parsePipeline.ts` because it is a RULE, and that module
 * owns exactly one (the order). Two rules live here:
 *
 * ## ⛔ EVERY FACT IS ATTRIBUTED TO THE PERSON, AND `correction` IS NOT AN ENGINE
 *
 * `ParseFactSource` exists as a SECOND AXIS beside `ParseEngine` for exactly this: a cook is neither `crf`
 * nor `llm`, and the repair was never to widen `PARSE_ENGINES` — that set is
 * `ingredient_parse_cache.engine`'s CHECK-constrained key domain, where a third member is "a compile error
 * **and a migration**". A correction is not a cache row and has no engine version.
 *
 * ## ⛔ `reviewReasons` IS EMPTY, AND DERIVING IT WOULD BE WRONG RATHER THAN MERELY DIFFERENT
 *
 * The cache's rehydration re-reads `statedMeasure` to recover an engine's review reasons, and that is right
 * there: an engine's reasons ARE a function of the measure it read. A correction is not. The cook supplies
 * `quantity` and `unit` DIRECTLY, so they may deliberately assert `absent` — or assert an exact amount for a
 * phrase no parser can read, which is one of the reasons a line gets corrected in the first place. Re-reading
 * the phrase would then raise `no_quantity` against a fact a human overrode.
 *
 * And the field's own definition settles it: `ParsedLine.reviewReasons` is "why this line still wants a
 * human's eye". A human's eye has been on it.
 *
 * ⚠️ Accepted consequence, stated rather than hidden: a correction that fixes only the food NAME also clears
 * whatever the measure was flagged for. That is the honest reading of a per-line correction — the cook was
 * shown the whole line and asserted the whole line — and the alternative (carrying an engine's reasons onto
 * a parse the engine did not produce) attributes a machine's doubt to a person's answer.
 *
 * ## ⚠️ THE FOODS ARE NOT RE-FILED THROUGH KTD-11b
 *
 * The comparator canonicalises placement on both engines' answers because it is adjudicating two machines.
 * Applying that lexicon to a person's assertion would let a vocabulary overrule the cook this tier exists to
 * obey — and `modifierLexicon`'s own accepted limit is that it "only decides the words it knows", which is a
 * safe property for an engine's output and a presumptuous one for a human's.
 */
import type { ParsedFacts, ParsedLine, ParseProvenance } from '../parsedLine.js';

/** Every fact of a corrected line was asserted by a person, so none of it is attributed to an engine. */
const CORRECTED_THROUGHOUT: ParseProvenance = {
    statedMeasure: 'correction',
    quantity: 'correction',
    unit: 'correction',
    foods: 'correction',
};

/**
 * Promote one cook's correction to the canonical parse.
 *
 * @param facts - The corrected facts, already read at the boundary by `readStoredParseFacts`.
 * @param sourceLine - The line as it was submitted, byte-identical (HAZ-041). A correction row stores its
 *   own `source_line`, but that is the line the CORRECTING cook saw; the line being parsed now is this
 *   caller's, and the two are only equal up to the normalized key that matched them.
 * @returns The canonical parse, attributed wholly to the correction, wanting no further review. Pure and
 *   TOTAL — a correction naming no food promotes to a line with no foods, which is a cook saying this line
 *   names none.
 */
export function promoteCorrection(facts: ParsedFacts, sourceLine: string): ParsedLine {
    return {
        raw: sourceLine,
        statedMeasure: facts.statedMeasure,
        quantity: facts.quantity,
        unit: facts.unit,
        foods: facts.foods,
        reviewReasons: [],
        provenance: CORRECTED_THROUGHOUT,
    };
}
