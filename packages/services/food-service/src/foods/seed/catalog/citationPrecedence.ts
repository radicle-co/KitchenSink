/**
 * The one policy that picks a root's cited dataset from its candidates (plan KTD-22, R50). The seed image asserts that
 * every committed citation is this policy's choice, so a hand edit cannot bypass the order.
 *
 * @pattern Policy — a pure ranking over candidates; the image resolves each candidate's energy
 *
 * Candidates fall into pools, and an earlier pool always wins:
 *
 * 1. an exact, same-substance or close table entry that states energy;
 * 2. a Branded product or a label that states energy;
 * 3. an exact, same-substance or close table entry without energy;
 * 4. a Branded product or a label without energy;
 * 5. a generic table entry.
 *
 * So analysed values beat a label (R50), a citation never trades calories for a better name, and a generic entry never
 * displaces a product or a label. Within a pool, match quality decides, then energy, then the dataset order.
 *
 * @module
 */
import { CITATION_DATASETS, type CitationDataset } from '../citationDatasets.js';

/** How well a candidate matches the root, best first. A same-substance candidate is the same food in another form. */
export const CITATION_MATCHES = ['exact', 'sameSubstance', 'close', 'generic'] as const;

/** How well a candidate matches the root. */
export type CitationMatch = (typeof CITATION_MATCHES)[number];

/** One candidate for a root's numbers. */
export interface CitationCandidate {
    /** The dataset it is read from. */
    readonly dataset: CitationDataset;
    /** The dataset's own key for the entry. */
    readonly key: string;
    /** How well it matches the root. */
    readonly match: CitationMatch;
    /** Whether the entry has an energy value. */
    readonly hasEnergy: boolean;
}

/** The policy's answer: no candidate, one chosen, or a tie it refuses to break. */
export type CitationChoice<T extends CitationCandidate> =
    | { readonly kind: 'none' }
    | { readonly kind: 'chosen'; readonly candidate: T }
    | { readonly kind: 'tie'; readonly candidates: readonly T[] };

/** The fallback datasets: a product's or a manufacturer's own numbers. */
const FALLBACK_DATASETS: ReadonlySet<CitationDataset> = new Set(['usdaBranded', 'label']);

/** A match's tier: exact and same substance rank together. */
const TIER: Readonly<Record<CitationMatch, number>> = { exact: 0, sameSubstance: 0, close: 1, generic: 2 };

/** The worst tier at which a table entry can displace a fallback. */
const DISPLACING_TIER = TIER.close;

/**
 * A candidate's pool, as the module comment orders them. Pure.
 *
 * @param candidate - The candidate.
 * @returns Its pool, 0 first.
 */
function poolOf(candidate: CitationCandidate): number {
    if (FALLBACK_DATASETS.has(candidate.dataset)) {
        return candidate.hasEnergy ? 1 : 3;
    }

    if (TIER[candidate.match] <= DISPLACING_TIER) {
        return candidate.hasEnergy ? 0 : 2;
    }

    return 4;
}

/**
 * Compare two candidates: pool, then tier, then energy, then dataset order. Pure.
 *
 * @param left - A candidate.
 * @param right - A candidate.
 * @returns Negative when `left` ranks higher, and zero when they rank equally.
 */
function byRank(left: CitationCandidate, right: CitationCandidate): number {
    return (
        poolOf(left) - poolOf(right) ||
        TIER[left.match] - TIER[right.match] ||
        Number(right.hasEnergy) - Number(left.hasEnergy) ||
        CITATION_DATASETS.indexOf(left.dataset) - CITATION_DATASETS.indexOf(right.dataset)
    );
}

/**
 * Choose a root's citation. Pure.
 *
 * @param candidates - Every candidate for the root. A caller may carry its own fields on each; a chosen candidate is
 *   one it passed.
 * @returns `none` for no candidates, the one best candidate, or a `tie` naming every candidate that ranks equally
 *   with the best, in the order given. A tie is the curator's to settle by grading one candidate lower.
 */
export function chooseCitation<T extends CitationCandidate>(candidates: readonly T[]): CitationChoice<T> {
    const ranked = [...candidates].sort(byRank);
    const [first] = ranked;

    if (first === undefined) {
        return { kind: 'none' };
    }

    const top = ranked.filter((candidate) => byRank(candidate, first) === 0);

    return top.length === 1 ? { kind: 'chosen', candidate: first } : { kind: 'tie', candidates: top };
}
