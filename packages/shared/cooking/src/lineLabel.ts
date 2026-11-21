/**
 * The label a step line gives its timer: the words in front of the one duration the line writes ("Roast 20 min" gives
 * "Roast"). The reducer only carries a label; this is the one place that reads it from a line (S3a.U3 C1 item 5, po
 * P23). Cooking mode calls it when a cook starts the offered timer.
 */

import { readDuration } from './duration.js';

/** Words that join a verb to its time and say nothing about the step ("for", "about", "another", "until"). */
const CONNECTOR_WORDS: ReadonlySet<string> = new Set([
    'for',
    'about',
    'around',
    'roughly',
    'approximately',
    'approx',
    'another',
    'further',
    'more',
    'a',
    'an',
    'in',
    'after',
    'within',
    'over',
    'until',
    'or',
    'and',
    'then',
]);

/**
 * Where the label starts again: a sentence end (a stop, `!`, `?` or `;` followed by white space, so "180.5" stays whole)
 * or the word "then", which ends a clause like a full stop (designer D80).
 */
const CLAUSE_END = /[.!?;](?=\s)|\bthen\b/giu;

/** "approx." is an abbreviation, not a sentence end: it reads as the connector "approx". */
const ABBREVIATION = /\bapprox\./giu;

/** The most words a label has. A longer one gives no label, and a label is never cut to fit (designer D80). */
const LABEL_WORDS_MAX = 4;

/** The text after the last clause end, or all of it when there is none. */
function lastClause(line: string): string {
    const text = line.replace(ABBREVIATION, 'approx');
    const last = [...text.matchAll(CLAUSE_END)].at(-1);

    return last === undefined ? text : text.slice(last.index + last[0].length);
}

/** The one word in front of the first comma, when the text has a comma after a single word; else the text. */
function leadWordOrAll(text: string): string {
    const lead = text.split(',')[0]?.trim() ?? '';

    return text.includes(',') && /^\p{L}+$/u.test(lead) ? lead : text;
}

/** A space or a punctuation mark: what sits between words and after the last one. */
const MARK = /[\s\p{P}]/u;

/** The text without its trailing spaces and punctuation. A loop from the end, so no pattern can back-track. */
function withoutTrailingMarks(text: string): string {
    let end = text.length;

    while (end > 0 && MARK.test(text.charAt(end - 1))) {
        end -= 1;
    }

    return text.slice(0, end);
}

/** The last word of `text` when it ends the text and stands alone (not glued to a digit), else `undefined`. */
function trailingWord(text: string): { readonly word: string; readonly start: number } | undefined {
    const last = [...text.matchAll(/\p{L}+/gu)].at(-1);

    if (last === undefined || last.index + last[0].length !== text.length) {
        return undefined;
    }

    return last.index === 0 || MARK.test(text.charAt(last.index - 1))
        ? { word: last[0], start: last.index }
        : undefined;
}

/** Drops trailing spaces and punctuation, then a trailing connector word, until neither is left. */
function withoutTrailingConnectors(text: string): string {
    let rest = withoutTrailingMarks(text);

    for (;;) {
        const trailing = trailingWord(rest);

        if (trailing === undefined || !CONNECTOR_WORDS.has(trailing.word.toLowerCase())) {
            return rest;
        }

        rest = withoutTrailingMarks(rest.slice(0, trailing.start));
    }
}

/**
 * The label a line gives its timer.
 *
 * @param line - A step line, as cooking mode shows it.
 * @returns The words before the line's one duration, cut at the last sentence end, with trailing connector words and
 *   punctuation dropped and the first letter upper-cased. `undefined` when the line has no single duration or nothing
 *   is left in front of it. Pure.
 */
export function lineLabelOf(line: string): string | undefined {
    const reading = readDuration(line);

    if (reading.kind !== 'one') {
        return undefined;
    }

    const words = leadWordOrAll(withoutTrailingConnectors(lastClause(line.slice(0, reading.span.start))).trimStart());
    const first = words.charAt(0);

    if (words.split(/\s+/u).length > LABEL_WORDS_MAX) {
        return undefined;
    }

    return first === '' ? undefined : `${first.toUpperCase()}${words.slice(1)}`;
}
