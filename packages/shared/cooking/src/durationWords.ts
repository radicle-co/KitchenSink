/**
 * The word grammar of a step's time: "an hour and a half", "ten to fifteen minutes", "twenty-five minutes".
 *
 * DESIGN PATTERN: the second link of a Chain of Responsibility with a fixed order of two. `readDuration` asks the digit
 * layer first and consults this layer only when the digit layer matched no span, so a line that has a digit time is
 * never read by it. The number lexicon is the shared Registry in `@kitchensink/recipe-core/parsing/number-words`.
 *
 * A wrong timer is worse than no timer, so every table below errs towards reading nothing. The grammar is a token walk,
 * not a regular expression, which keeps it readable and free of backtracking on hostile text. It reads English only.
 */

import { FRACTION_WORD_DENOMINATORS, readNumberWords } from '@kitchensink/recipe-core/parsing/number-words';
import { SECONDS_PER_TIME_UNIT, TIME_UNIT_WORDS } from '@kitchensink/recipe-core/time-unit-words';

import { oneReading, type DurationReading } from './durationReading.js';

/**
 * Seconds per unit word, from the one list of time words. The singular `second` is here, but an article never counts it
 * ("a second" is a moment). The bare `h` is a digit-layer unit only: "ten h" is not read.
 */
const UNIT_SECONDS: ReadonlyMap<string, number> = new Map(
    Object.entries(TIME_UNIT_WORDS)
        .filter(([word]) => word !== 'h')
        .map(([word, unit]): [string, number] => [word, SECONDS_PER_TIME_UNIT[unit]]),
);

/** The only units an article counts: "a minute" is one, "a second" is a moment and "a day" is not read. */
const ARTICLE_UNITS: ReadonlySet<string> = new Set(['hour', 'minute']);

/** Phrases that state a time without a number word, longest first. */
const FIXED_PHRASES: readonly { readonly words: readonly string[]; readonly seconds: number }[] = [
    { words: ['three', 'quarters', 'of', 'an', 'hour'], seconds: 2_700 },
    { words: ['a', 'quarter', 'of', 'an', 'hour'], seconds: 900 },
    { words: ['an', 'hour', 'and', 'a', 'half'], seconds: 5_400 },
    { words: ['half', 'an', 'hour'], seconds: 1_800 },
];

/** What may follow "a minute" or "an hour" for the article to count one: "an hour glass" is not a time. */
const ARTICLE_FOLLOWERS: ReadonlySet<string> = new Set(['or', 'and', 'then', 'more', 'longer', 'until', 'to']);

/** The tokens that are not words but still end one: punctuation, and a digit run. */
const BOUNDARY = /^[^a-z]/u;

/** A word before a span that makes its time a repeat or an amount per event ("every five minutes"). */
const REPEAT_WORDS: ReadonlySet<string> = new Set(['every', 'once', 'twice']);

/** The words after a span that make its time a part of the step, not the step's wait. */
const PART_PHRASES: readonly (readonly string[])[] = [
    ['before', 'the', 'end'],
    ['each', 'side'],
    // A rate per weight ("ten minutes per pound", "twenty minutes to the pound") is not a wait.
    ['per'],
    ['to', 'the'],
];

/** Words are lower-case letter runs. Punctuation and digit runs are their own tokens. Anything else is a separator. */
const TOKEN = /[a-z]+|\d+|[.,;:!?()]/gu;

interface Amount {
    readonly seconds: number;
    readonly highSeconds?: number;
    readonly rank: number;
    readonly next: number;
}

const isWord = (token: string | undefined): token is string => token !== undefined && !BOUNDARY.test(token);

const isArticle = (token: string | undefined): boolean => token === 'a' || token === 'an';

/** The fixed phrase at `index`, if one starts there. */
function fixedPhraseAt(tokens: readonly string[], index: number): Amount | undefined {
    for (const phrase of FIXED_PHRASES) {
        if (phrase.words.every((word, offset) => tokens[index + offset] === word)) {
            return { seconds: phrase.seconds, rank: SECONDS_PER_TIME_UNIT.hour, next: index + phrase.words.length };
        }
    }

    return undefined;
}

/** A number word that is not an article, as a count, or `undefined`. */
function countAt(tokens: readonly string[], index: number): { value: number; next: number } | undefined {
    return isArticle(tokens[index]) ? undefined : readNumberWords(tokens, index);
}

/** "ten to fifteen minutes", "five or six minutes": a range reads its low end and keeps its high end. */
function rangeAt(tokens: readonly string[], index: number): Amount | undefined {
    const low = countAt(tokens, index);
    const joiner = low === undefined ? undefined : tokens[low.next];

    if (low === undefined || (joiner !== 'to' && joiner !== 'or')) {
        return undefined;
    }

    const high = countAt(tokens, low.next + 1);
    const unit = high === undefined ? undefined : UNIT_SECONDS.get(tokens[high.next] ?? '');

    return high === undefined || unit === undefined
        ? undefined
        : { seconds: low.value * unit, highSeconds: high.value * unit, rank: unit, next: high.next + 1 };
}

/** "twenty minutes", "forty-five minutes": a count and a unit. */
function countedAt(tokens: readonly string[], index: number): Amount | undefined {
    const count = countAt(tokens, index);
    const unit = count === undefined ? undefined : UNIT_SECONDS.get(tokens[count.next] ?? '');

    return count === undefined || unit === undefined
        ? undefined
        : { seconds: count.value * unit, rank: unit, next: count.next + 1 };
}

/** "an hour", "a minute", but only where the next token cannot make the unit a part of another word or phrase. */
function articleAt(tokens: readonly string[], index: number): Amount | undefined {
    const unitWord = tokens[index + 1] ?? '';
    const follower = tokens[index + 2];

    if (!isArticle(tokens[index]) || !ARTICLE_UNITS.has(unitWord)) {
        return undefined;
    }

    if (follower !== undefined && isWord(follower) && !ARTICLE_FOLLOWERS.has(follower)) {
        return undefined;
    }

    const rank = UNIT_SECONDS.get(unitWord) ?? 0;

    return { seconds: rank, rank, next: index + 2 };
}

/** The first amount that reads at `index`, in the order the grammar tries them. */
function amountAt(tokens: readonly string[], index: number): Amount | undefined {
    return (
        fixedPhraseAt(tokens, index) ?? rangeAt(tokens, index) ?? countedAt(tokens, index) ?? articleAt(tokens, index)
    );
}

/** One span: its amounts joined by "and", a comma or a space, as the digit reader joins them. */
interface Span {
    readonly seconds: number;
    readonly highSeconds?: number;
    readonly start: number;
    readonly end: number;
}

/** The span that starts at `start`, `'many'` when its units do not strictly fall, or `undefined`. */
function spanAt(tokens: readonly string[], start: number): Span | 'many' | undefined {
    const first = amountAt(tokens, start);

    if (first === undefined) {
        return undefined;
    }

    let seconds = first.seconds;
    let end = first.next;
    let rank = first.rank;
    let amounts = 1;

    for (;;) {
        let from = end;

        if (tokens[from] === ',') {
            from += 1;
        }

        if (tokens[from] === 'and') {
            from += 1;
        }

        const joined = amountAt(tokens, from);

        if (joined === undefined) {
            break;
        }

        if (joined.rank >= rank) {
            return 'many';
        }

        seconds += joined.seconds;
        rank = joined.rank;
        end = joined.next;
        amounts += 1;
    }

    return amounts === 1 && first.highSeconds !== undefined
        ? { seconds, highSeconds: first.highSeconds, start, end }
        : { seconds, start, end };
}

/** Whether an article or number word at `index` is followed by a fraction word ("a half", "one-half", "a quarter"). */
function isFractionAfterCount(tokens: readonly string[], index: number): boolean {
    const next = isArticle(tokens[index]) ? index + 1 : readNumberWords(tokens, index)?.next;

    return next !== undefined && FRACTION_WORD_DENOMINATORS.has(tokens[next] ?? '');
}

/** Whether the words around a span make its time a repeat, a part of the step, or a hedge. */
function isUnreadable(tokens: readonly string[], span: Span): boolean {
    const before = tokens[span.start - 1];
    // The longest look-ahead is four tokens: "and", a two-word count, then a fraction word.
    const after = tokens.slice(span.end, span.end + 4);

    if (before !== undefined && REPEAT_WORDS.has(before)) {
        return true;
    }

    if (PART_PHRASES.some((phrase) => phrase.every((word, offset) => after[offset] === word))) {
        return true;
    }

    // "and a half", "and one-half", "and a quarter": the span is cut short, and only the fixed phrase reads it whole.
    if (after[0] === 'and' && isFractionAfterCount(after, 1)) {
        return true;
    }

    // "or" after a span hedges it ("a minute or two", "an hour or so"), except "or until", which names the end. One
    // opening bracket or comma may sit before it ("an hour (or overnight)", "ten minutes, or until thick").
    const hedge = after[0] === '(' || after[0] === ',' ? 1 : 0;

    return after[hedge] === 'or' && after[hedge + 1] !== 'until';
}

/**
 * Read the one duration a line writes in words.
 *
 * @param line - A step line with no digit time. The caller owns that gate.
 * @returns `one` with the seconds of the span (a range gives its low end, and its high end as `highSeconds`), `many`
 *   when two or more spans are written, else `none`. A hedged, repeated or partial time is `none`. Pure.
 */
export function readWordDuration(line: string): DurationReading {
    const tokens = line.toLowerCase().match(TOKEN) ?? [];
    const spans: Span[] = [];

    for (let index = 0; index < tokens.length;) {
        const span = spanAt(tokens, index);

        if (span === 'many') {
            return { kind: 'many' };
        }

        if (span === undefined) {
            index += 1;
            continue;
        }

        if (isUnreadable(tokens, span)) {
            return { kind: 'none' };
        }

        spans.push(span);
        index = span.end;
    }

    const [only] = spans;

    if (spans.length > 1) {
        return { kind: 'many' };
    }

    if (only === undefined || only.seconds <= 0) {
        return { kind: 'none' };
    }

    return oneReading(only.seconds, only.highSeconds);
}
