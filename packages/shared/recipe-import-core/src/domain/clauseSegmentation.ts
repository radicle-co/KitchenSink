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
 * instruction residue to remove. What separates them is a **unit of substance** — the same requirement
 * `proseRecipe`'s own scan already uses ("Requiring a UNIT is what keeps 'cook two hours' … from being
 * read as ingredients"). So the guard asks `parseIngredientLine`, from every quantity phrase in the tail.
 *
 * ⚠️ Accepted conservatism, stated rather than hidden: a tail whose unit is a DIMENSION (`one-quarter
 * inch thick`) reads as a food to this guard and refuses the cut. That leaves the status quo for such a
 * span — never a loss — and the vocabulary that would sharpen it (`NOT_A_MEASURE`) belongs to the
 * importer's own gate, not here. A VESSEL is a different matter and is NOT conservative in the safe
 * direction: `a large frying-pan` parses as a measured thing, and treating it as a food refused a cut and
 * lost a real ingredient, so the vessel vocabulary settles the tail as well as the head.
 */
import { parseIngredientLine } from '../ingredientLine.js';
import { findQuantityPhrases } from '../quantityPhrases.js';

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
 * Vessels and equipment, for the HEAD-FINAL test only.
 *
 * ⛔ This is culinary vocabulary, which the neighbouring lexicons deliberately avoid — so the reason it is
 * admissible has to be stated. It removes things that are **not foods at all**, exactly as
 * `proseRecipe`'s `NOT_AN_INGREDIENT` does, and never rewrites a food; it therefore cannot be used to
 * nudge a name toward a catalog match, which is the property that would corrupt the resolution
 * measurement. `a large preserving kettle` parses to `1 large :: preserving kettle` and passes every
 * structural gate the importer has, so nothing but a vocabulary can tell it from `one large beet`.
 *
 * ⚠️ Matched against the LAST word of the head, never anywhere in it. English puts the noun a phrase is
 * ABOUT at the end of it, so `one pound of pot roast` is a roast and `a large preserving kettle` is a
 * kettle — and `a dish of stewed prunes` is prunes, which is why container words that also introduce a
 * food (`dish`, `jar`, `tin`) are safe to list.
 *
 * ⚠️ Accepted limit, the same one `modifierLexicon` states: a lexicon only decides the words it knows.
 * An unlisted vessel stays an ingredient and reaches the engines as it does today, which is the direction
 * that loses nothing.
 */
const VESSELS: ReadonlySet<string> = new Set([
    'basin',
    'boiler',
    'bowl',
    'bowls',
    'casserole',
    'colander',
    'dish',
    'dishes',
    'frying-pan',
    'frying-pans',
    'griddle',
    'gridiron',
    'jar',
    'jars',
    'kettle',
    'kettles',
    'mold',
    'molds',
    'mould',
    'moulds',
    'mortar',
    'oven',
    'pan',
    'pans',
    'platter',
    'pot',
    'pots',
    'roaster',
    'saucepan',
    'saucepans',
    'sieve',
    'sifter',
    'skillet',
    'skillets',
    // A 1900s frying pan, and one of the words KTD-11b found the two engines contesting.
    'spider',
    'spiders',
    'steamer',
    'stewpan',
    'stew-pan',
    'stove',
    'strainer',
    'tin',
    'tins',
]);

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
    const head = boundary === null ? trimmed : trimmed.slice(0, boundary).trim();
    const tail = boundary === null ? null : trimmed.slice(boundary).trim();

    // ⛔ EQUIPMENT IS JUDGED ON THE PROPOSED HEAD, ALWAYS — never on a span whose cut was refused below.
    // Measured 2026-08-25 over the whole 1919 book: judging the refused span instead reads its LAST word,
    // which is the tail's last word rather than the food the span is about, and
    // `one tablespoon of butter in a large frying-pan` was classified as a frying-pan and dropped. A span
    // is only ever "about" the text before its boundary.
    if (head === '' || isEquipment(head)) {
        return { kind: 'instruction' };
    }

    // ⛔ THE GUARD. A tail stating its own measured food is not an instruction, and cutting it would
    // delete an amount the source printed. The whole span survives instead, for `ParsedLine.foods` to carry.
    if (tail === null || tail === '' || statesASecondFood(tail)) {
        return { kind: 'ingredient', span: trimmed, trailingInstruction: null };
    }

    return { kind: 'ingredient', span: head, trailingInstruction: tail };
}

/**
 * Cut a NAME down at the same boundary, unconditionally.
 *
 * ⚠️ NOT {@link segmentClause} with the tail thrown away, and the difference is the second-food guard.
 * A span has somewhere to keep a second food — `ParsedLine.foods` holds many — so its cut is refused
 * rather than risked. A NAME has exactly one field and no such place, and a name carrying a measurement
 * (`chocolate in one cup of water`) matches no catalog row at all, so its cut is unconditional. Two
 * views of one lexicon, for two different consequences.
 *
 * @param name - The description a parse engine returned.
 * @returns The name up to the first instruction boundary. Pure and TOTAL.
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
 * Whether a tail states a food with a measured amount of its own.
 *
 * ⛔ Scanned from EVERY quantity phrase in the tail, not once from its start. `a pan with one cup of
 * water` reads from its start as `1 :: pan with one cup of water` — a quantity, no unit — and would clear
 * a single-parse guard while hiding a real second food one phrase further in. The phrase scan is the same
 * one `suffixStarts` uses for the same reason.
 *
 * @param tail - The text that would be cut off.
 * @returns `true` when cutting would delete a stated amount of a food. Pure.
 */
function statesASecondFood(tail: string): boolean {
    return findQuantityPhrases(tail).some((phrase) => {
        const parsed = parseIngredientLine(tail.slice(phrase.start));

        return (
            parsed.quantity.kind !== 'absent' &&
            parsed.unit !== null &&
            parsed.name.trim() !== '' &&
            // ⛔ A VESSEL IS NOT A FOOD, however it parses. `a large frying-pan` comes back as
            // `1 large :: frying-pan` because `parse-ingredient` reads `large` as a unit, which cleared
            // every structural test above and refused a cut that should have been made — measured on the
            // whole 1919 book, it cost `Melt one tablespoon of butter in a large frying-pan` its butter.
            // The same vocabulary that classifies a whole span settles it, rather than a second rule.
            //
            // ⚠️ Bounded FIRST. A tail's own name carries the same residue the span does — `one cup of
            // water in a kettle` parses to the name `water in a kettle` — and asking the head-final test
            // about that reads `kettle` and throws away a real second food. The food is what the name is
            // about, which is exactly what `dropTrailingInstruction` returns.
            !isEquipment(dropTrailingInstruction(parsed.name))
        );
    });
}

/**
 * Whether a head names a vessel rather than a food.
 *
 * @param head - The bounded span.
 * @returns `true` when its last word is equipment. Pure.
 */
function isEquipment(head: string): boolean {
    const last = head.split(/\s+/).at(-1) ?? '';

    return VESSELS.has(last.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, ''));
}
