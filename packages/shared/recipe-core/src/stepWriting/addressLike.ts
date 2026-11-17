/**
 * The one address detector for step-writing text.
 *
 * A written step and a fact name both refuse anything that reads as a link or an address, so the rule lives here
 * once. It reads raw text and is pure.
 *
 * What counts: a `//`, a letter followed by a colon and a digit (a host and port), a dotted-quad IPv4 address, and a dot
 * between a letter or digit and a letter, or a letter and a digit (a domain such as `evil.com`, `evil.c0m` or
 * `evil2.com`). An ideographic or full-width full stop between two ASCII letters or digits counts as a dot, and
 * full-width forms are folded to ASCII first. A decimal such as `2.5`, a spaced full stop such as `St. Louis`, a time
 * such as `1:30` and a Japanese sentence break are not addresses. The abbreviations `e.g.`, `i.e.`, `a.m.` and `p.m.`
 * are removed before the check.
 */

/** A full stop in the ideographic and half-width forms, between two ASCII letters or digits: a dot in disguise. */
const DISGUISED_DOT = /(?<=[A-Za-z0-9])[。．｡](?=[A-Za-z0-9])/gu;

/** Abbreviations whose dots are not a domain. */
const ABBREVIATION = /\b(?:e\.g|i\.e|a\.m|p\.m)\./giu;

const ADDRESS = /\/\/|\p{L}:\d|\b\d{1,3}(?:\.\d{1,3}){3}\b|[\p{L}\p{N}]\.\p{L}|\p{L}\.\p{N}/u;

/**
 * Whether the text reads as a link or an address.
 *
 * @param text - Raw text.
 * @returns True when it does. Pure.
 */
export function looksLikeAddress(text: string): boolean {
    return ADDRESS.test(text.replace(DISGUISED_DOT, '.').normalize('NFKC').replace(ABBREVIATION, ' '));
}
