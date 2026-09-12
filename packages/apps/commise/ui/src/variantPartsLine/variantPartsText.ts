/**
 * @module @commise/ui/variant-parts-line — the dotted line's text rules, shared by the web and native leaves
 * (`docs/design/ingredientSpecialization.md` §2d and §S4). Each platform draws them its own way: web wraps a
 * measurement token in a `nowrap` span, native shows its hyphen as U+2011.
 *
 * @pattern Specification — `isMeasurementToken` names the one token that never breaks at its hyphen
 */

/** What goes between two parts: a no-break space, so a dot never starts a line, then a middle dot. */
export const PART_SEPARATOR = '\u00A0\u00B7';

/**
 * The parts as a screen reader hears them: the source text joined with commas (D3). Pure.
 *
 * ⛔ The one authority for the spoken form. The native leaf's label uses it, and so does every message template
 * that says a variant's parts (`{parts}` in `docs/design/ingredientSpecialization.md` §S11).
 *
 * @param parts - The display text of each part, in wire order.
 * @returns The spoken text.
 */
export function spokenVariantParts(parts: readonly string[]): string {
    return parts.join(', ');
}

/** A number, then a hyphen, then a unit: `0-inch`, `1/8-inch`. Other hyphenated words may still break. */
const MEASUREMENT_TOKEN = /^\d[\d/.]*-[a-z]+$/iu;

/** One stretch of a part's text, and whether it is a measurement token. */
export interface PartRun {
    readonly text: string;
    readonly measurement: boolean;
}

/**
 * Whether a token is a measurement that must stay on one line. Pure.
 *
 * @param token - One whitespace-free token of a part.
 * @returns `true` for a number joined to a unit by a hyphen.
 */
export function isMeasurementToken(token: string): boolean {
    return MEASUREMENT_TOKEN.test(token);
}

/**
 * Split a part into runs, so each measurement token is a run of its own. Pure. The runs join back to the part
 * exactly: nothing is dropped, rewritten or reordered (§2d).
 *
 * @param part - The display text of one part.
 * @returns The part's runs in order; a part with no measurement is one run.
 */
export function partRuns(part: string): readonly PartRun[] {
    const runs: PartRun[] = [];

    for (const token of part.split(/(\s+)/u)) {
        const measurement = isMeasurementToken(token);
        const previous = runs.at(-1);

        if (previous !== undefined && !measurement && !previous.measurement) {
            runs[runs.length - 1] = { text: previous.text + token, measurement: false };
        } else if (token !== '') {
            runs.push({ text: token, measurement });
        }
    }

    return runs;
}
