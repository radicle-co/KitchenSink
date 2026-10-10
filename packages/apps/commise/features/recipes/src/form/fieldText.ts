/**
 * @module @commise/features-recipes/form — the editor's text-field rules (`docs/design/uiOverhaul/buildSpec.md` §7.4):
 * what a soft length limit reads for a text, and the single-line rule the title keeps.
 *
 * Pure and platform-agnostic: the web and native Details leaves read the same counter from the same text.
 */

/** What a field with a soft limit shows for its text. */
export interface LimitReading {
    /** The length counted: the TRIMMED text's, as `validateRecipeForm` counts it. */
    readonly count: number;
    /** Whether the "{count}/{max}" counter shows. */
    readonly shown: boolean;
    /** Whether the text is past the limit: the counter turns `danger` and the field is invalid. */
    readonly over: boolean;
}

/**
 * Read a text against a soft limit. Pure.
 *
 * @param text - The field's text.
 * @param max - The limit; past it the text is over.
 * @param from - The length from which the counter shows.
 * @returns The reading.
 */
export function readLimit(text: string, max: number, from: number): LimitReading {
    const count = text.trim().length;

    return { count, shown: count >= from, over: count > max };
}

/**
 * The text with every line break replaced by a space: the title is one line however its text arrives (Enter, a paste,
 * the native keyboard's return key). Pure.
 *
 * @param text - The typed or pasted text.
 * @returns The text on one line.
 */
export function singleLine(text: string): string {
    return text.replace(/\r\n|\r|\n/gu, ' ');
}
