/**
 * A text parsed as JSON, or `undefined` for a text that is not JSON. The client reads two kinds of text that may not
 * be: an error body, which a proxy in front of food can answer with its own page, and a progressive search line.
 *
 * @module
 */

/**
 * A text's JSON value, or `undefined` when it is not JSON. Pure.
 *
 * @param text - The text.
 * @returns The value.
 */
export function jsonOf(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}
