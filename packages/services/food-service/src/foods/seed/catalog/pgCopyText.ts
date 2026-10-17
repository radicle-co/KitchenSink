/**
 * One row of PostgreSQL's COPY text format, the format the seed stages its rows in (curated catalog plan KTD-1).
 *
 * The format is PostgreSQL's own (the manual's "COPY — File Formats — Text Format"): fields separated by a tab, a row
 * ended by a newline, NULL written `\N`, and a backslash, newline, carriage return or tab inside a value escaped with a
 * backslash. Those four escapes and the NULL marker are the whole of what a writer owes, which is why no CSV library is
 * used: CSV spells NULL and the empty string alike unless every field's quoting is configured, and the text format has
 * no such ambiguity. `pg-copy-streams` moves the bytes and encodes nothing.
 */

/** A value a staged column takes: text, a boolean, a whole number, or NULL. */
export type CopyValue = string | boolean | number | null;

/**
 * Escape one text value. Pure.
 *
 * The backslash is escaped first, so an escape this writes is never escaped again.
 *
 * @param value - The text.
 * @returns The escaped text.
 */
function escapeText(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t');
}

/**
 * One field. Pure.
 *
 * @param value - The value.
 * @returns Its text-format spelling.
 * @throws {RangeError} for a number that is not a safe whole number: a decimal is staged as its exact string.
 */
function fieldOf(value: CopyValue): string {
    if (value === null) {
        return '\\N';
    }

    if (typeof value === 'boolean') {
        return value ? 't' : 'f';
    }

    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
            throw new RangeError(`a staged number must be a safe whole number, not ${String(value)}`);
        }

        return String(value);
    }

    return escapeText(value);
}

/**
 * One row, ready to write to a `COPY ... FROM STDIN` in text format. Pure.
 *
 * @param values - The row's values, in the COPY's column order.
 * @returns The row, ending in a newline.
 * @throws {RangeError} for a number that is not a safe whole number.
 */
export function copyTextLine(values: readonly CopyValue[]): string {
    return `${values.map(fieldOf).join('\t')}\n`;
}
