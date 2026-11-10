/**
 * The one way the parsing modules put supplied text inside a pattern.
 *
 * Library-first was checked. `RegExp.escape` is ES2025, past this package's ES2022 target and not promised on the
 * Hermes engine the mobile app runs this code on, and `escape-string-regexp` is only a transitive install here, so
 * depending on it would add a package to every app for one line.
 */

/**
 * `text` with every regular-expression metacharacter escaped, so it matches only itself. Pure.
 *
 * @param text - The literal text.
 * @returns A pattern source for it.
 */
export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}
