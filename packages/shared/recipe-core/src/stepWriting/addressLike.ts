/**
 * The English address rule: what reads as a link or an address in Latin text.
 *
 * A written step and a fact name both refuse anything that reads as a link or an address. The doors first accept only
 * the language's alphabet (see `alphabet.ts`), then call this rule. It reads text and is pure.
 *
 * What counts: a `//`, a URL scheme followed by a colon (also when a tab or line break splits it), a letter followed by
 * a colon and a digit (a host and port), a dotted-quad IPv4 address, and a dot between a letter or digit and a letter,
 * or a letter and a digit (a domain such as `evil.com`, `evil.c0m`, `evil2.com` or `t.co`). The text is first folded
 * with NFKC and stripped of default-ignorable characters. A decimal such as `2.5`, a spaced full stop such as
 * `St. Louis` and a time such as `1:30` are not addresses. A closed list of abbreviations (`e.g.`, `i.e.`, `a.m.`,
 * `p.m.`, `fl.oz.`, `A.1.`) is ignored, but only when nothing word-like follows, so `e.g.com` is still a host.
 *
 * Why not a link-detection library such as linkify-it: its fuzzy mode flags only hosts on known top-level domains, so
 * `evil.cooking` and `evil.zip` would pass.
 */

/** Characters Unicode marks as default-ignorable: invisible, and free to sit inside a word. */
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

/** Abbreviations whose dots are not a domain, when nothing word-like follows. */
const ABBREVIATION = /\b(?:e\.g|i\.e|a\.m|p\.m|fl\.oz|a\.1)\.(?![\p{L}\p{N}])/giu;

/** Tab, line feed and carriage return: URL parsers drop them, so `java\tscript:` is still a scheme. */
const LINE_BREAKS = /[\t\n\r]/gu;

/** A URL scheme and its colon. */
const SCHEME = /\b(?:javascript|data|vbscript|file|https?|ftp|mailto|blob|tel|sms):/iu;

const ADDRESS = /\/\/|\p{L}:\d|\b\d{1,3}(?:\.\d{1,3}){3}\b|[\p{L}\p{N}]\.\p{L}|\p{L}\.\p{N}/u;

/**
 * Whether the text reads as a link or an address.
 *
 * @param text - Raw text.
 * @returns True when it does. Pure.
 */
export function looksLikeAddress(text: string): boolean {
    const folded = text.normalize('NFKC').replace(DEFAULT_IGNORABLE, '').replace(ABBREVIATION, ' ');

    return SCHEME.test(folded.replace(LINE_BREAKS, '')) || ADDRESS.test(folded);
}
