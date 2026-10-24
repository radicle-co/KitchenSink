/**
 * @module @commise/features-recipes — a label in sentence case.
 *
 * A facet value is stored as the author wrote it ("dairy-free", "vegan"), and a chip names it in sentence case
 * (`docs/design/uiOverhaul/buildSpec.md` §4.3). The value stays raw for matching; only the label changes. Case is a
 * locale rule (Turkish capitalises "i" to the dotted "İ"), so the viewer's locale is an argument, never assumed.
 */

/**
 * The text with its first letter in upper case and the rest untouched, so an acronym or a proper noun inside survives.
 * Pure.
 *
 * @param text - The text, e.g. a stored dietary flag.
 * @param locale - The viewer's locale, whose case rules apply.
 * @returns The text in sentence case; an empty text stays empty.
 */
export function sentenceCase(text: string, locale: string): string {
    // A code point and not a UTF-16 unit, so a letter outside the BMP is lifted whole.
    const [first = ''] = text;

    return first.toLocaleUpperCase(locale) + text.slice(first.length);
}
