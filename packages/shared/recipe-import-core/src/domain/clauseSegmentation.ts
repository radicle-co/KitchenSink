/**
 * @module clauseSegmentation — where an ingredient span ENDS inside a clause of prose.
 *
 * DESIGN PATTERN: **Lexicon behind a pure total function returning an explicit outcome** — the sibling of
 * `modifierLexicon.ts`, and the same discipline: a vocabulary is a piece of knowledge, filed apart from
 * the pipeline that consumes it. The outcome is a discriminated union rather than a nullable string, so
 * "this text is not an ingredient at all" cannot be read as "this ingredient has an empty tail".
 *
 * ## The knowledge this owns, and the half it does NOT
 *
 * `cookbook-import`'s `proseRecipe.ts` already owns where an ingredient span STARTS: `suffixStarts`
 * scans a clause for the leftmost suffix that reads as a quantity, and that scan is R29-measured. What
 * nothing owned is where the span ENDS. The end was implicitly "the clause's end", so a clause carrying
 * an ingredient AND an instruction — which is ordinary in this corpus — handed both parse engines the
 * instruction too.
 *
 * ## ⛔ THE DEFECT THIS CLOSES (KTD-11a, measured 2026-08-23 over 354 `differ` cases)
 *
 * Reading the sample: `one tablespoon of butter in a frying-pan`, `one pound of flour into a deep bowl`,
 * `one pint of milk for five minutes`, `two pints of water overnight`, `four tablespoons of flour to it`
 * — and `a large preserving kettle`, which is equipment. A vessel, a duration, a target. **Neither engine
 * is wrong**; both are handed prose that should never have reached a parser. The CRF folds it into the
 * name, the LLM files it as prep, and the comparator scores a disagreement that is not one.
 *
 * ## ⛔ THE DANGER, AND THE GUARD (the reason this module is not a regex)
 *
 * `one-half pound chocolate in one cup of water` looks identical to the cases above and is not: the tail
 * is a **SECOND FOOD**. Dropping it deletes an amount the source states — value corruption, on exactly
 * the line class KTD-11a was found on. So {@link statesASecondFood} REFUSES the cut whenever the tail
 * reads as a food with a measured amount, and the whole span survives for `ParsedLine.foods`, which holds
 * many, to carry.
 *
 * ⚠️ The guard cannot simply be "the tail contains a quantity phrase", which is the obvious reading and is
 * WRONG on the corpus: `five minutes` and `twenty minutes` are quantity phrases, and KTD-11a names both as
 * instruction residue to remove.
 *
 * ⛔ Nor can it be "the tail states a UNIT", which was the first attempt and **deleted real food twice**.
 * That test is not the question:
 *
 *  - `two eggs` parses to `{quantity: 2, unit: null, name: 'eggs'}` — the normal form of every count
 *    ingredient in a cookbook — so a unit test cannot see it, and `one cup of milk with two eggs` lost its
 *    eggs with `droppedLines` EMPTY. `five minutes` has no unit either, so the test did not even separate
 *    the cases it was justified by.
 *  - `a large frying-pan` parses to `1 large :: frying-pan`, because `parse-ingredient` reads `large` as a
 *    unit — so a unit test called a VESSEL a food, refused the cut, and `one tablespoon of butter in a
 *    large frying-pan` lost its butter.
 *
 * The question is whether the noun the tail is about **is a substance**, which `notAFoodLexicon.ts`
 * answers. A vessel, a duration, a dimension and a count of people are not; everything else is treated as
 * a food, which is the direction that loses nothing — a refused cut costs only the status quo, while a
 * wrong cut deletes an amount the source printed.
 */
import { parseIngredientLine } from '../ingredientLine.js';
import { findQuantityPhrases } from '../quantityPhrases.js';
import { measuresNoSubstance, namesEquipment, namesNoFood } from './notAFoodLexicon.js';

/**
 * What one accepted span of prose turned out to be.
 *
 * ⚠️ `instruction` raises no review reason anywhere, deliberately. A flag on a line nobody meant to parse
 * is the muted-signal failure KTD-11 rules against — "a flag that fires on half of everything is how a
 * real signal gets muted" — so the caller DROPS it exactly as it drops any clause that carries no
 * ingredient. Only a real loss (`ingredient` with a non-null tail) is worth a reason.
 */
export type ClauseSegment =
    | {
          readonly kind: 'ingredient';
          /** The ingredient, in the source's own words, bounded at its end. */
          readonly span: string;
          /**
           * The instruction text cut off the end, or `null` when there was nothing to cut.
           *
           * ⛔ Never `''`. The caller raises `instruction_text_dropped` on the ABSENCE of null, and an
           * empty string would make "nothing was lost" indistinguishable from "something was".
           */
          readonly trailingInstruction: string | null;
      }
    | { readonly kind: 'instruction' };

/**
 * Where an instruction may begin inside a span.
 *
 * ⚠️ This is GRAMMAR — prepositions, conjunctions and the auxiliaries these books attach to a verb — and
 * it is the lexicon `proseRecipe`'s `trimName` already carried, MOVED here so there is one authority
 * rather than one copy per view. Nothing that names or describes a food appears in it: cutting at `in`
 * removes a vessel, it never rewrites an ingredient toward a friendlier catalog match.
 *
 * The punctuation alternative has no surrounding whitespace requirement because a comma, semicolon, colon
 * or opening bracket ends a noun phrase wherever it sits.
 */
const INSTRUCTION_BOUNDARY =
    /\s+(?:in|into|with|and|or|that|which|until|then|over|for|from|when|to|on|at|will|has|have|had|is|are|was|were|may|should|must|can)\s+|[,;:(]/g;

/**
 * Bound one accepted span at the end of its ingredient.
 *
 * @param span - The suffix of a clause that read as a quantified ingredient, in the source's own words.
 * @returns The bounded ingredient plus whatever was cut, or `instruction` when the span names no food at
 *   all. Pure and TOTAL — never throws, and answers for empty input.
 */
export function segmentClause(span: string): ClauseSegment {
    const trimmed = span.trim();
    const boundary = instructionBoundaryIn(trimmed);

    if (boundary === null) {
        // Nothing to cut. The span is an ingredient unless the whole of it names something that is not a
        // food — `a large preserving kettle`, which parses to `1 large :: preserving kettle` and clears
        // every structural gate the importer has.
        return trimmed === '' || namesEquipment(trimmed)
            ? { kind: 'instruction' }
            : { kind: 'ingredient', span: trimmed, trailingInstruction: null };
    }

    const head = trimmed.slice(0, boundary).trim();
    const tail = trimmed.slice(boundary).trim();

    // ⛔ THE GUARD, AND IT RUNS FIRST. A tail naming a food of its own is not an instruction, and cutting
    // it would delete an amount the source printed. The whole span survives instead, for
    // `ParsedLine.foods` — which holds many — to carry.
    //
    // ⛔ Ordering is load-bearing. Judging equipment before this ran the head-final test on a span whose
    // cut was about to be REFUSED, so `a large kettle with two cups of sugar` came back `instruction` and
    // the sugar went with it. A refused cut yields the whole span and is never judged equipment at all;
    // equipment is only ever decided about a head the boundary actually takes.
    if (tail === '' || statesASecondFood(tail)) {
        return { kind: 'ingredient', span: trimmed, trailingInstruction: null };
    }

    // ⛔ `namesEquipment`, NOT `namesNoFood`. Asking the wider question here dropped
    // `Sift one cup of flour three times` — a stated amount of a real food — because the span ends on a
    // duration word. Only a VESSEL means "this span is not an ingredient".
    if (head === '' || namesEquipment(head)) {
        return { kind: 'instruction' };
    }

    return { kind: 'ingredient', span: head, trailingInstruction: tail };
}

/**
 * Cut a NAME down at the first instruction boundary, without the second-food guard.
 *
 * ⚠️ NOT {@link segmentClause} with the tail thrown away, and the difference is exactly that guard. A span
 * has somewhere to keep a second food — `ParsedLine.foods` holds many — so its cut is refused rather than
 * risked. A NAME has one field and no such place, and a name carrying a measurement
 * (`chocolate in one cup of water`) matches no catalog row at all, so nothing is gained by keeping it.
 * Two views of one lexicon, for two different consequences.
 *
 * ⚠️ "Without the guard" is not "unconditional", and the earlier wording overstated it: this still
 * refuses a boundary at offset 0 and one inside a quantity phrase, because both are properties of the
 * BOUNDARY rather than of the consequence. The offset-0 refusal is a deliberate behaviour change from the
 * `split(…)[0]` this replaced — that returned `''` for `', sifted'`, and `''` is what `proseRecipe`'s
 * empty-name check drops a line on. A name that is nothing but a boundary is now returned intact and the
 * caller's own `NOT_AN_INGREDIENT` gate judges it, which is the layer that owns that decision.
 *
 * @param name - The description a parse engine returned.
 * @returns The name up to the first instruction boundary that is really one. Pure and TOTAL.
 */
export function dropTrailingInstruction(name: string): string {
    const boundary = instructionBoundaryIn(name);

    return boundary === null ? name : name.slice(0, boundary).trim();
}

/**
 * The first instruction boundary that is really one.
 *
 * ⛔ A boundary INSIDE a quantity phrase is not a boundary (R29). `and` is in the lexicon and is also the
 * middle of `"One and one-half"`, which is verbatim in the committed corpus slice; cutting there hands
 * the engines `One` — the same third-of-the-stated-amount loss `splitClauses` already guards against one
 * layer up, and by the same mechanism.
 *
 * A boundary at offset 0 is refused too: there is no ingredient before it to keep.
 *
 * @param text - Any span or name.
 * @returns The offset of the boundary, or `null` when there is none. Pure.
 */
function instructionBoundaryIn(text: string): number | null {
    const phrases = findQuantityPhrases(text);

    for (const match of text.matchAll(INSTRUCTION_BOUNDARY)) {
        const at = match.index;

        if (at === 0 || phrases.some((phrase) => at >= phrase.start && at < phrase.end)) {
            continue;
        }

        return at;
    }

    return null;
}

/**
 * Whether a tail names a food with a stated amount of its own.
 *
 * ⛔ Scanned from EVERY quantity phrase in the tail, not once from its start. `a pan with one cup of
 * water` reads from its start as `1 :: pan with one cup of water` — a quantity, no unit — and would clear
 * a single-parse guard while hiding a real second food one phrase further in. The phrase scan is the same
 * one `suffixStarts` uses, for the same reason.
 *
 * ⛔ The test is `namesNoFood`, NOT `unit !== null`. See the module docstring: the unit test deleted
 * `two eggs` (a food with no unit) and preserved `a large frying-pan` (a vessel with one), which is both
 * failure directions from a single wrong question.
 *
 * ⚠️ The name is BOUNDED before it is classified. A tail's own name carries the same residue a span does
 * — `one cup of water in a kettle` parses to the name `water in a kettle` — and asking the head-final
 * test about that reads `kettle` and throws away a real second food.
 *
 * @param tail - The text that would be cut off.
 * @returns `true` when cutting would delete a stated amount of a food. Pure.
 */
function statesASecondFood(tail: string): boolean {
    return findQuantityPhrases(tail).some((phrase) => {
        const parsed = parseIngredientLine(tail.slice(phrase.start));
        const food = dropTrailingInstruction(parsed.name).trim();

        return (
            parsed.quantity.kind !== 'absent' &&
            food !== '' &&
            !namesNoFood(food) &&
            // A unit that measures time, distance or temperature says the amount is not an amount of food,
            // however food-like the noun beside it reads.
            !(parsed.unit !== null && measuresNoSubstance(parsed.unit))
        );
    });
}
