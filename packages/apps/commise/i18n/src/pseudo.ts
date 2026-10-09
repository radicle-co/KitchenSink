/**
 * Pseudo-localisation: English, accented, bracketed and grown by a factor, so a layout that only fits its English
 * strings shows it (`docs/architecture/uiOverhaulBlueprint.md` Part B, "Pseudo-localisation"). The web app serves it as
 * the `en-XA` locale in a build that asks for it; `controlLabels.spec.ts` lays the app out in it.
 *
 * Hand-rolled on purpose. `pseudo-localization` (npm) accents every character it is given, so it would rewrite a
 * `{title}` placeholder that `fillTemplate` fills AFTER this runs, and it grows text by a fixed vowel-doubling rule,
 * not by the factor the spec names. What is left once both are handled is a 20-letter table.
 */

/** The expansion the build spec asks for: +35% (spec §13). */
export const PSEUDO_EXPANSION = 0.35;

/** Latin letters and the accented letter that stands in for each. Letters not listed are kept. */
const ACCENTED: Readonly<Record<string, string>> = {
    a: 'á',
    e: 'é',
    i: 'í',
    o: 'ó',
    u: 'ú',
    y: 'ý',
    c: 'ç',
    n: 'ñ',
    s: 'ś',
    z: 'ź',
    v: 'ṽ',
    r: 'ŕ',
    A: 'Á',
    E: 'É',
    I: 'Í',
    O: 'Ó',
    U: 'Ú',
    Y: 'Ý',
    C: 'Ç',
    N: 'Ñ',
    S: 'Ś',
    Z: 'Ź',
    V: 'Ṽ',
    R: 'Ŕ',
};

/** The filler the padding is cut from: short words with spaces, so an over-long label wraps rather than overflowing. */
const FILLER = 'ŀőŕéɱ ïƥśüɱ ðőŀőŕ śïţ áɱéţ ';

/** A `{placeholder}`, which is kept byte for byte. */
const PLACEHOLDER = /(\{[^{}]*\})/u;

/**
 * One string, pseudo-localised: letters accented, placeholders kept, padded by `factor` of its length with spaced
 * filler words, and bracketed. An empty string stays empty. Pure.
 *
 * @param text - The English string.
 * @param factor - How much longer to make it (0.35 = 35%).
 * @returns The pseudo string.
 */
export function pseudoString(text: string, factor: number = PSEUDO_EXPANSION): string {
    if (text.length === 0) {
        return text;
    }

    const accented = text
        .split(PLACEHOLDER)
        .map((part) => (PLACEHOLDER.test(part) ? part : [...part].map((letter) => ACCENTED[letter] ?? letter).join('')))
        .join('');
    const padLength = Math.ceil(text.length * factor);

    if (padLength === 0) {
        return `[${accented}]`;
    }

    // The separating space stands in for the one trailing space a cut through the filler can leave and trimEnd drops,
    // so the text grows by at least `padLength` either way.
    const padding = FILLER.repeat(Math.ceil(padLength / FILLER.length))
        .slice(0, padLength)
        .trimEnd();

    return `[${accented} ${padding}]`;
}

/**
 * A message bundle, pseudo-localised: every string at any depth (arrays included) through {@link pseudoString};
 * numbers, booleans and functions as they are. A new object; the input is not touched. Pure.
 *
 * @param messages - One locale's messages.
 * @param factor - How much longer to make each string.
 * @returns The same shape, pseudo-localised.
 */
export function pseudoExpand<T>(messages: T, factor: number = PSEUDO_EXPANSION): T {
    return expand(messages, factor) as T;
}

/** The recursion behind {@link pseudoExpand}, over values whose shape it only learns at run time. Pure. */
function expand(value: unknown, factor: number): unknown {
    if (typeof value === 'string') {
        return pseudoString(value, factor);
    }

    if (Array.isArray(value)) {
        return value.map((item: unknown) => expand(item, factor));
    }

    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, factor)]));
    }

    return value;
}
