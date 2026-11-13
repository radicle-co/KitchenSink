/**
 * @module @commise/i18n — the `{token}` filler every localized message goes through. Its own module, so a model that
 * fills a message depends on this alone.
 */

/**
 * Replace `{token}` placeholders in `template` with the matching value from `tokens`. Unknown tokens are
 * left intact rather than throwing (a missing translation variable degrades gracefully). Pure.
 *
 * @param template - A string containing zero or more `{name}` placeholders.
 * @param tokens - The values to substitute, keyed by placeholder name.
 * @returns The template with known placeholders filled.
 */
export const fillTemplate = (template: string, tokens: Readonly<Record<string, string | number>>): string =>
    template.replace(/\{(\w+)\}/g, (match, key: string) => (Object.hasOwn(tokens, key) ? String(tokens[key]) : match));
