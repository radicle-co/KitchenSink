/**
 * @module testing/present — a test's way to ask for an element it expects, without a cast.
 */

/**
 * The value, or a failure that says what was missing. A bare `as` cast would hide a missing node as a `TypeError`.
 *
 * @param found - What a query returned.
 * @param what - What the test expected to find, for the message.
 * @returns The value, narrowed to not be null or undefined.
 * @throws Error when nothing was found.
 */
export function present<T>(found: T | null | undefined, what: string): T {
    if (found === null || found === undefined) {
        throw new Error(`Expected ${what} to be drawn.`);
    }

    return found;
}
