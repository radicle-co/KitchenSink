/**
 * The text of a scalar read out of a workflow or template YAML document (`with:`, `env:`, `inputs:` values).
 *
 * YAML types a scalar as a string, number or boolean, and a guard compares its text. `String()` over an unknown
 * value would read a mapping or a sequence that landed where a scalar belongs as `[object Object]` — a value no
 * assertion expects, so the guard fails for the wrong reason or, worse, a `not.toContain` passes. This refuses it.
 */

/**
 * Read a YAML scalar as text. Pure.
 *
 * @param value - The parsed value.
 * @param fallback - The text for an absent (`undefined` or `null`) value.
 * @returns The scalar's text, or `fallback`.
 * @throws {TypeError} when the value is a mapping or a sequence.
 */
export function scalarText(value: unknown, fallback = ''): string {
    if (value === undefined || value === null) {
        return fallback;
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }

    throw new TypeError(`expected a YAML scalar, got a ${Array.isArray(value) ? 'sequence' : 'mapping'}`);
}
