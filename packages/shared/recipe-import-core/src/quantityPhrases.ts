/**
 * WHERE the quantity phrases sit in a body of prose.
 *
 * DESIGN PATTERN: Scanner over {@link normalizeQuantity}'s Adapter. It answers one question — which
 * character ranges of this text are a number — and answers it by asking the grammar, never by knowing any
 * of it.
 *
 * ## Why this is a shared module rather than a regex in the importer
 *
 * `cookbook-import` splits prose into clauses on a bare ` and `, which is load-bearing: these books chain
 * several ingredients into one punctuation-free breath. But `"one and one-half pounds"` is ONE number
 * containing that same word, and splitting it published a third of the stated quantity. Deciding which
 * `and` is which needs the number lexicon, and that lexicon has exactly one owner (`quantityWords.ts`).
 * Restating it in the importer would be a second representation that drifts the first time a word is
 * added.
 *
 * The work is linear in the input: one bounded tokenization per word position, and a matched phrase
 * advances the scan past itself.
 */
import { normalizeQuantity } from './normalizeQuantity.js';

/** A half-open character range of the scanned text that reads as one quantity phrase. */
export interface QuantityPhraseSpan {
    /** Index of the phrase's first character. */
    readonly start: number;
    /** Index one past the phrase's last character. */
    readonly end: number;
}

/**
 * Find every leading-maximal quantity phrase in a text.
 *
 * @param text - Prose, possibly untrusted and possibly long.
 * @returns Non-overlapping spans in source order, each covering exactly what the grammar consumed —
 *   including a compound's internal `"and"`. Pure and TOTAL.
 */
export function findQuantityPhrases(text: string): readonly QuantityPhraseSpan[] {
    const spans: QuantityPhraseSpan[] = [];
    let cursor = 0;

    // ⚠️ Runs of LETTERS AND DIGITS, not `\S+`. These books glue a run-in heading to the first quantity
    // with no space — `"*Icing for This Cake.*--One and one-half cups"` is one whitespace-delimited token,
    // so a `\S+` scan never probes `One` and the phrase it opens goes unseen. `\p{N}` covers the vulgar
    // fractions too, so `"1½"` stays one run.
    for (const word of text.matchAll(/[\p{L}\p{N}]+/gu)) {
        if (word.index < cursor) {
            // Inside a phrase already claimed. A number is read WHOLE or not at all, so re-reading from
            // the middle of one could only produce a shorter, wrong answer.
            continue;
        }

        const reading = normalizeQuantity(text.slice(word.index));

        if (reading.quantity === null) {
            continue;
        }

        // `normalizeQuantity` reports the consumed text and the remainder, so the phrase's end is fixed by
        // what is left rather than by re-searching for the phrase — which would find the wrong occurrence
        // when the same words appear twice in one line.
        const end = word.index + (text.length - word.index - reading.rest.length);
        const start = end - reading.phrase.length;

        spans.push({ start, end });
        cursor = end;
    }

    return spans;
}
