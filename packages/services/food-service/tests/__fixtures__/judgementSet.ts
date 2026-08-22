/**
 * The Golden Relevance Judgement Set — what the catalog SHOULD return, and how confident we are that we know.
 *
 * ## What this measures, and what it deliberately does not
 *
 * It measures the SERVER's ranking. U1 requires a second, separate baseline for what a user actually sees —
 * the client-re-sorted top-1 for every distinct query in the import corpus — because `rankIngredientSuggestions`
 * re-ranks within each provenance section and preserves the server's local-before-catalog order. "Zero
 * regressions" against server output alone would measure the server against itself while the picker silently
 * got worse. That second baseline is not here; it needs the import corpus.
 *
 * ## The annotation protocol, and why the numbers are useless without it
 *
 * U5's floors are `precision@1 >= 0.9` single-token and `>= 0.85` multi-word. Against a set one person
 * labelled, those measure agreement with one person's taste — the over-fitting R58 and R59 exist to prevent.
 * Published work puts three annotators in unanimous agreement on the correct USDA row only **61%** of the
 * time, and dietitians at **51%**. So a floor of 0.9 may sit above our own measurable ceiling, and we cannot
 * know which until the set is labelled twice.
 *
 * Hence: **two independent labels per entry**, a third adjudicating pass on any disagreement with its
 * resolution recorded in `why`, and the observed agreement rate committed alongside the set so the floors are
 * read against our ceiling rather than a published one.
 *
 * ## ⛔ This set is NOT gate-ready, by construction
 *
 * Every entry carries one `proposed` label and awaits a human `second` pass. A machine can propose a label; it
 * cannot be two independent annotators, and a set that reported 100% agreement because it had only ever been
 * labelled once would be worse than no set — it would license the floors it was supposed to justify.
 * {@link isGateReady} is false while that holds and {@link observedAgreementRate} withholds a number rather
 * than flattering one. `judgementSetProtocol.test.ts` asserts both, so the state is visible in CI rather than
 * in a comment.
 *
 * **Two things are missing and both need a human:**
 *  1. A second independent label on every entry, then adjudication of the disagreements.
 *  2. The multi-word entries R58 requires be SAMPLED FROM THE IMPORT CORPUS rather than from the cases used to
 *     design the weights — sampling from the design cases is how a judgement set launders its own assumptions.
 *     The corpus is an operator-downloaded file (`packages/tools/cookbook-import/README.md`, step 1) that is
 *     deliberately absent from this repository, and nothing here may fetch it (ADR-0023).
 *
 * The three entries below are the ones the plan names outright. They are single-token or short catalog
 * queries whose correct answer is a USDA row name, so they can be authored without the corpus — but they are a
 * seed, not the >= 60 the plan requires.
 */

/** Who produced a label. `proposed` is machine-authored; the rest are independent human passes. */
export type Annotator = 'proposed' | 'second';

/** One annotator's answer for one query. */
export interface JudgementLabel {
    /** Which pass produced this label. */
    readonly annotator: Annotator;
    /** The catalog row this annotator says should rank first. */
    readonly expectedTopFoodName: string;
}

/** The third pass's resolution of a disagreement between the two labels. */
export interface Adjudication {
    /** The name the adjudicator settled on. */
    readonly expectedTopFoodName: string;
    /** Why — recorded so a later reader can re-open the decision rather than re-derive it. */
    readonly why: string;
}

/** One judgement-set entry. */
export interface JudgementEntry {
    /** What a cook types. */
    readonly query: string;
    /** Independent labels. Gate-ready entries carry two. */
    readonly labels: readonly JudgementLabel[];
    /** Why this is the right answer, and — after adjudication — how the disagreement was resolved. */
    readonly why: string;
    /** A `knownMiss` asserts the tiers still DO NOT solve this, so a silent fix is also a signal. */
    readonly knownMiss: boolean;
    /** Present only when the two labels disagreed. */
    readonly adjudication?: Adjudication;
}

/**
 * Whether an entry has been labelled twice and any disagreement resolved.
 *
 * @param entry - The entry to judge.
 * @returns True when two annotators have labelled it and a disagreement, if any, was adjudicated. Pure.
 */
function isSettled(entry: JudgementEntry): boolean {
    const annotators = new Set(entry.labels.map((label) => label.annotator));

    if (annotators.size < 2) {
        return false;
    }

    const names = new Set(entry.labels.map((label) => label.expectedTopFoodName));

    return names.size === 1 || entry.adjudication !== undefined;
}

/**
 * Whether the whole set may be used as an acceptance gate.
 *
 * @param entries - The set.
 * @returns True only when every entry is settled. Pure.
 */
export function isGateReady(entries: readonly JudgementEntry[]): boolean {
    return entries.length > 0 && entries.every(isSettled);
}

/**
 * The measured share of entries on which the two independent annotators agreed WITHOUT adjudication.
 *
 * ⚠️ Returns `undefined` rather than a number when the set is not gate-ready. A rate computed over
 * single-label entries is 1.0 by construction, and that number would be quoted as evidence for the very
 * floors it cannot support.
 *
 * @param entries - The set.
 * @returns The agreement rate in `[0, 1]`, or `undefined` when the set has not been labelled twice. Pure.
 */
export function observedAgreementRate(entries: readonly JudgementEntry[]): number | undefined {
    if (!isGateReady(entries)) {
        return undefined;
    }

    const agreed = entries.filter((entry) => new Set(entry.labels.map((l) => l.expectedTopFoodName)).size === 1);

    return agreed.length / entries.length;
}

/**
 * The set. ⛔ A seed of the three entries the plan names, not the >= 60 it requires — see the header.
 */
export const JUDGEMENT_SET: readonly JudgementEntry[] = [
    {
        query: 'flour',
        labels: [{ annotator: 'proposed', expectedTopFoodName: 'Flour' }],
        why: 'The single-token attractor case: `Carob flour` currently wins because word_similarity scores both 1.0 and `name ASC` breaks the tie alphabetically. The name that IS the token must beat the name that merely contains it.',
        knownMiss: false,
    },
    {
        query: 'brown sugar',
        labels: [{ annotator: 'proposed', expectedTopFoodName: 'Sugars, brown' }],
        why: 'A two-token query whose correct answer is a comma-inverted USDA name, so it exercises inversion handling rather than prefix matching.',
        knownMiss: false,
    },
    {
        query: 'red wine vinegar',
        labels: [{ annotator: 'proposed', expectedTopFoodName: 'Vinegar, red wine' }],
        why: 'A three-token query fully inverted against the USDA name. The plan records word-order inversion as something the tiers do NOT solve, so this doubles as the shape a known-miss entry should take once measured.',
        knownMiss: false,
    },
];
