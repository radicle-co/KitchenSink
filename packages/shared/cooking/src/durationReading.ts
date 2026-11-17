/**
 * What a line says about time, and the one way a reading is built.
 *
 * DESIGN PATTERN: Smart Constructor — `oneReading` is the only way a `one` reading is built, and it holds the range
 * invariant (the high end is above the low end, or absent).
 *
 * Both layers of the reader (`duration.ts` for digits, `durationWords.ts` for words) end in a `one` reading, so the
 * range rule lives here once.
 */

/**
 * What a line says: no duration, exactly one (in seconds), or several. A range ("20 to 25 minutes") gives its low end
 * as `seconds` and its high end as `highSeconds`. Only a span that is one range carries `highSeconds`.
 */
export type DurationReading =
    | { readonly kind: 'none' }
    | { readonly kind: 'one'; readonly seconds: number; readonly highSeconds?: number }
    | { readonly kind: 'many' };

/**
 * Build a `one` reading. The high end of a range is kept only when it is above the low end, so a reversed or equal
 * range ("fifteen to ten minutes", "20 to 20 minutes") reads as its low end alone. It is never swapped: a swap guesses
 * what the cook meant. Both ends are rounded to whole seconds. Pure.
 *
 * @param seconds - The low end, or the whole duration.
 * @param high - The high end of a range, if the span is one.
 * @returns The `one` reading.
 */
export function oneReading(seconds: number, high?: number): DurationReading {
    const low = Math.round(seconds);
    const top = high === undefined ? undefined : Math.round(high);

    return top !== undefined && top > low
        ? { kind: 'one', seconds: low, highSeconds: top }
        : { kind: 'one', seconds: low };
}
