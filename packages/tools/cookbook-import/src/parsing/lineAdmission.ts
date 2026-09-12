/**
 * @module lineAdmission — whether a clause the cookbook import would send to the parse engines reads as a cooking
 * instruction instead (plan 001 §5; owner ruling 2026-10-01: cookbook import only). `runImport.ts` skips such a
 * clause before either engine is asked about it.
 *
 * The rule is CLOSED-WORLD. The clause OPENS with an imperative cooking verb, and every other word is known to name
 * no food: a verb, a method word (`instructionLexicon.ts`), a vessel or a no-substance measure (`recipe-import-core`'s
 * `namesNoFood`), or a word inside a quantity phrase (the number itself). Any other word lets the clause through,
 * because an unknown word is how a food appears: `put in a bowl` and `Bake 25 minutes` read as instructions, while
 * `add a carrot`, `Beat 2 eggs` and `Add a cup of milk` do not. A quantity of a food needs no rule of its own: the
 * unit or the food after the number is an unknown word.
 *
 * Words are read with the not-a-food lexicon's own fold (`lastWordOf`: split on whitespace, drop punctuation), which
 * keys `frying-pan` whole. A token with no letter outside a quantity phrase is a number, punctuation or part of an
 * amount (`(four`), not a word to judge; one with a letter outside is judged (`eggs` in `2eggs`).
 *
 * ⛔ The two errors are not equal. A false refusal never parses an ingredient the book states; a false admission is
 * the behaviour without the gate. Measured 2026-09-30 (`docs/reports/2026-09-30/instructionGateMeasurement.md`): a
 * verb-first rule with no closed-world half skipped 25 labelled NYT ingredient lines and many 1919 clauses that are
 * the book's only statement of a food; this rule skipped none of either.
 *
 * @pattern Specification — `readsAsInstruction` over the instruction lexicon, the not-a-food lexicon and the quantity
 *   scanner, each the one owner of its question
 */
import { findQuantityPhrases, lastWordOf, namesNoFood, type QuantityPhraseSpan } from '@kitchensink/recipe-import-core';

import { isImperativeCookingVerb, isMethodWord } from './instructionLexicon.js';

/** Every whitespace-delimited token of a text: the lexicon's split, before its fold. */
const TOKENS = /\S+/gu;

/** Every letter of a text. */
const LETTERS = /\p{L}/gu;

/**
 * Whether no letter of `line[start, end)` lies outside a quantity phrase. Pure. A token with no letter at all
 * qualifies, so a bare number or a punctuation mark is never judged as a word.
 *
 * @param line - The whole line.
 * @param start - The token's first index.
 * @param end - One past the token's last index.
 * @param spans - The line's quantity phrases.
 * @returns `true` when the token is a number, punctuation or part of an amount rather than a word to judge.
 */
function hasNoLetterOutsideQuantity(
    line: string,
    start: number,
    end: number,
    spans: readonly QuantityPhraseSpan[],
): boolean {
    return [...line.slice(start, end).matchAll(LETTERS)].every((letter) =>
        spans.some((span) => start + letter.index >= span.start && start + letter.index < span.end),
    );
}

/**
 * Whether a folded word is known to name no food. Pure.
 *
 * @param word - One word, folded by `lastWordOf`.
 * @returns `true` for a verb, a method word, a vessel or a no-substance measure.
 */
function namesNoFoodHere(word: string): boolean {
    return isImperativeCookingVerb(word) || isMethodWord(word) || namesNoFood(word);
}

/**
 * Whether a clause reads as a cooking instruction. Pure and total.
 *
 * @param line - One clause, as the import extracted it.
 * @returns `true` only for a clause that opens with an imperative cooking verb and holds no word outside the known
 *   non-food vocabulary, a quantity phrase's own words aside.
 */
export function readsAsInstruction(line: string): boolean {
    const tokens = [...line.matchAll(TOKENS)].map((token) => ({
        start: token.index,
        end: token.index + token[0].length,
        word: lastWordOf(token[0]),
    }));
    const first = tokens[0];

    if (first === undefined || !isImperativeCookingVerb(first.word)) {
        return false;
    }

    const spans = findQuantityPhrases(line);

    return tokens.every(
        ({ start, end, word }) => hasNoLetterOutsideQuantity(line, start, end, spans) || namesNoFoodHere(word),
    );
}
