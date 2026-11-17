/**
 * The English address rule: what reads as a link or an address in Latin text.
 *
 * A written step and a fact name both refuse anything that reads as a link or an address. The doors first accept only
 * the language's alphabet (see `alphabet.ts`), then call this rule. It reads text and is pure.
 *
 * What counts: a `//`, a URL scheme followed by a colon (also when a tab or line break splits it, and also when a
 * trade mark or degree Celsius sign sits in front), a letter followed by a colon and a digit (a host and port), a
 * dotted-quad IPv4 address, and any tight dot, that is a dot with no space after it (a domain such as `evil.com`,
 * `evil\u00AE.com`, `evil).com` or `t.co`). Fail closed: a tight `Stir...then bake` is refused too. The text is first
 * decoded of percent-escapes (`evil%2Ecom`), folded with NFKC and stripped of default-ignorable characters. A decimal
 * such as `2.5`, a spaced full stop such as `St. Louis` and a time such as `1:30` are not addresses. A closed list of
 * abbreviations (`e.g.`, `i.e.`, `a.m.`, `p.m.`, `fl.oz.`, `A.1.`) is ignored, but only when nothing word-like
 * follows, so `e.g.com` is still a host.
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

const ADDRESS = /\/\/|\p{L}:\d|\b\d{1,3}(?:\.\d{1,3}){3}\b/u;

/**
 * A tight dot: a dot with no space after it and something word-like or marked after. It counts unless it
 * sits between two digits (`2.5`), and a dot before a space or a closing mark (`bake.`, `(hot).`) does not count.
 * A dot at the start of the text or after a space counts only before a letter (`.com`).
 */
const TIGHT_DOT = /(?<=[^\s\d])\.(?=[^\s.,;:!?)"'’”%])|(?<=\d)\.(?=[^\d\s.,;:!?)"'’”%])|(?<!\S)\.(?=\p{L})/u;

/** A run of percent-escapes, so `%2E` reads as the dot it stands for. */
const PERCENT_RUN = /(?:%[0-9a-f]{2})+/giu;

/** Non-fatal on purpose: an invalid byte becomes U+FFFD, so one bad escape cannot hide a valid one beside it. */
const UTF8 = new TextDecoder();

/**
 * Decode percent-escapes until none change.
 *
 * @param text - Raw text.
 * @returns The text with every escape decoded, an invalid byte as U+FFFD. Pure.
 */
function percentDecoded(text: string): string {
    const once = text.replace(PERCENT_RUN, (run) =>
        UTF8.decode(Uint8Array.from(run.slice(1).split('%'), (hex) => Number.parseInt(hex, 16))),
    );

    return once === text ? text : percentDecoded(once);
}

/** The text with invisible characters and URL-ignored line breaks removed, for the scheme test. */
const forScheme = (text: string): string => text.replace(DEFAULT_IGNORABLE, '').replace(LINE_BREAKS, '');

/**
 * Whether the text reads as a link or an address.
 *
 * @param text - Raw text.
 * @returns True when it does. Pure.
 */
export function looksLikeAddress(text: string): boolean {
    const decoded = percentDecoded(text);
    const folded = decoded.normalize('NFKC').replace(DEFAULT_IGNORABLE, '').replace(ABBREVIATION, ' ');

    // The scheme is also tested on the NFC text: NFKC turns a trade mark or degree Celsius sign into letters, which
    // removes the word boundary that was in front of the scheme.
    return (
        SCHEME.test(forScheme(decoded.normalize('NFC'))) ||
        SCHEME.test(forScheme(folded)) ||
        ADDRESS.test(folded) ||
        TIGHT_DOT.test(folded)
    );
}
