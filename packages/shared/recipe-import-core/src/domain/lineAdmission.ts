/**
 * @module lineAdmission — whether a pasted line reads as a cooking instruction the parse leg should never be asked
 * about (plan 001 §5, option 3: admit the line, land it terminally, ask no engine).
 *
 * The rule is CLOSED-WORLD. The line OPENS with an imperative cooking verb, and every other word is one this package
 * knows names no food: a verb, a method word (`instructionLexicon.ts`), a vessel or a no-substance measure
 * (`notAFoodLexicon.ts`'s `namesNoFood`), or a word inside a quantity phrase (the number itself). Any other word lets
 * the line through, because an unknown word is how a food appears: `put in a bowl` and `Bake 25 minutes` read as
 * instructions, while `add a carrot`, `Beat 2 eggs` and `Add a cup of milk` do not. A quantity of a food needs no rule
 * of its own: the unit or the food after the number is an unknown word.
 *
 * Words are read with the not-a-food lexicon's own fold (`lastWordOf`: split on whitespace, drop punctuation), which
 * keys `frying-pan` whole. A token with no letter outside a quantity phrase is a number, punctuation or part of an
 * amount (`(four`), not a word to judge; one with a letter outside is judged (`eggs` in `2eggs`).
 *
 * ⛔ The two errors are not equal. A false refusal never parses an ingredient the cook pasted; a false admission is
 * today's behaviour. Measured 2026-09-30 (`docs/reports/2026-09-30/instructionGateMeasurement.md`): a verb-first rule
 * with no closed-world half skipped 25 labelled NYT ingredient lines and many 1919 clauses that are the book's only
 * statement of a food; this rule skipped none of either.
 *
 * ⚠️ Imports only the modules it asks, never the package barrel, which loads `sanitize-html` and `parse-ingredient`.
 * That keeps a subpath export open for a service that consumes this Specification (the measurement report's
 * question 3). The package exports only `.` today, so no consumer gets that saving yet.
 *
 * @pattern Specification — `readsAsInstruction` over the instruction lexicon, the not-a-food lexicon and the quantity
 *   scanner, each the one owner of its question
 */
import { findQuantityPhrases, type QuantityPhraseSpan } from '../quantityPhrases.js';
import { isImperativeCookingVerb, isMethodWord } from './instructionLexicon.js';
import { lastWordOf, namesNoFood } from './notAFoodLexicon.js';

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
 * Whether a pasted line reads as a cooking instruction. Pure and total.
 *
 * @param line - One pasted line, as the create path split it.
 * @returns `true` only for a line that opens with an imperative cooking verb and holds no word outside the known
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
