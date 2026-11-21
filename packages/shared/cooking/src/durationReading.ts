/**
 * What a line says about time, and the one way a reading is built.
 *
 * DESIGN PATTERN: Smart Constructor — `oneReading` is the only way a `one` reading is built, and it holds the range
 * invariant (the high end is above the low end, or absent).
 *
 * Both layers of the reader (`duration.ts` for digits, `durationWords.ts` for words) end in a `one` reading, so the
 * range rule lives here once.
 */

/** Where a reading found its time in the line given: code-unit offsets, `start` inclusive, `end` exclusive. */
export interface ReadingSpan {
    readonly start: number;
    readonly end: number;
}

/**
 * What a line says: no duration, exactly one (in seconds), or several. A range ("20 to 25 minutes") gives its low end
 * as `seconds` and its high end as `highSeconds`. Only a span that is one range carries `highSeconds`. `perRepeat` is
 * set when the time is for each repeat ("3 minutes per side"): the step takes it more than once, so a total must not
 * read it as exact. A `one` reading also says where in the line its time was written, so the words in front of it can
 * be read.
 */
export type DurationReading =
    | { readonly kind: 'none' }
    | {
          readonly kind: 'one';
          readonly seconds: number;
          readonly highSeconds?: number;
          readonly span: ReadingSpan;
          readonly perRepeat?: true;
      }
    | { readonly kind: 'many' };

/**
 * Build a `one` reading. The high end of a range is kept only when it is above the low end, so a reversed or equal
 * range ("fifteen to ten minutes", "20 to 20 minutes") reads as its low end alone. It is never swapped: a swap guesses
 * what the cook meant. Both ends are rounded to whole seconds. Pure.
 *
 * @param seconds - The low end, or the whole duration.
 * @param high - The high end of a range, if the span is one.
 * @param span - Where in the line the time was written.
 * @param perRepeat - Whether the time is for each repeat ("per side"). The mark is absent, never `false`.
 * @returns The `one` reading.
 */
export function oneReading(
    seconds: number,
    high: number | undefined,
    span: ReadingSpan,
    perRepeat = false,
): DurationReading {
    const low = Math.round(seconds);
    const top = high === undefined ? undefined : Math.round(high);
    const mark = perRepeat ? ({ perRepeat: true } as const) : {};

    return top !== undefined && top > low
        ? { kind: 'one', seconds: low, highSeconds: top, span, ...mark }
        : { kind: 'one', seconds: low, span, ...mark };
}
