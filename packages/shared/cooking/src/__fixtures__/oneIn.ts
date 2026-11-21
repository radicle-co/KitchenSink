import type { DurationReading } from '../durationReading.js';

/**
 * The `one` reading a line must give, with its span written as the text the time occupies in the line. The expected
 * offsets come from that text, never from the reader's own arithmetic, so a wrong offset fails.
 *
 * @param line - The step line the reader was given.
 * @param text - The exact text of the line the time occupies (its first occurrence in the line).
 * @param seconds - The low end, or the whole duration, in seconds.
 * @param highSeconds - The high end of a range.
 * @returns The expected reading. Throws when `text` is not in the line, so a mistyped case never passes. Pure.
 */
export function oneIn(line: string, text: string, seconds: number, highSeconds?: number): DurationReading {
    const start = line.indexOf(text);

    if (start < 0) {
        throw new Error(`"${text}" is not in "${line}"`);
    }

    const span = { start, end: start + text.length };

    return highSeconds === undefined ? { kind: 'one', seconds, span } : { kind: 'one', seconds, highSeconds, span };
}
