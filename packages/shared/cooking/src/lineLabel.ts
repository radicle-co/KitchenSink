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

/** A sentence end the label stops at: the label is the part of the sentence the time is in. */
const SENTENCE_END = /[.!?;]/gu;

/** The text after the last sentence end, or all of it when there is none. */
function lastSentence(text: string): string {
    const ends = [...text.matchAll(SENTENCE_END)];
    const last = ends.at(-1);

    return last === undefined ? text : text.slice(last.index + 1);
}

/** Drops trailing spaces and punctuation, then a trailing connector word, until neither is left. */
function withoutTrailingConnectors(text: string): string {
    let rest = text.replace(/[\s\p{P}]+$/u, '');

    for (;;) {
        const word = /(?:^|[\s\p{P}])([\p{L}]+)$/u.exec(rest);
        const connector = word?.[1];

        if (word === null || connector === undefined || !CONNECTOR_WORDS.has(connector.toLowerCase())) {
            return rest;
        }

        rest = rest.slice(0, word.index + word[0].length - connector.length).replace(/[\s\p{P}]+$/u, '');
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

    const words = withoutTrailingConnectors(lastSentence(line.slice(0, reading.span.start))).trimStart();
    const first = words.charAt(0);

    return first === '' ? undefined : `${first.toUpperCase()}${words.slice(1)}`;
}
