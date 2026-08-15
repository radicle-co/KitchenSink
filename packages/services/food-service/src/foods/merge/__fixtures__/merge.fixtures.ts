/**
 * Fixture factories for the golden-record merge engine (feature 003, Phase 6). `make*` builders
 * accepting `Partial<T>` per CODING_STANDARDS §"Fixture factories". The merge engine is generic over
 * the source-id type (`S extends string`) so its source-priority rules are unit-testable with synthetic
 * multi-source inputs even though the wired `food_source` enum currently lists only `usda`.
 */
import type { FoodSourceId } from '../../../sources/foodSourceAdapter.js';
import type { MergeCandidate } from '../mergeEngine.js';

/**
 * Build a {@link MergeCandidate} for a given source, overriding any field. `source` is passed
 * explicitly (typed `S`) so multi-source priority tests can model two distinct sources without
 * touching the canonical `food_source` enum.
 *
 * @param source - The candidate's source identifier (`'usda'` for production-shaped fixtures).
 * @param overrides - Field overrides merged over the default broccoli-shaped candidate.
 * @returns A fully-populated canonical candidate tagged with `source`.
 */
export function makeMergeCandidate<S extends string = FoodSourceId>(
    source: S,
    overrides: Partial<Omit<MergeCandidate<S>, 'source'>> = {},
): MergeCandidate<S> {
    return {
        source,
        externalKey: '171688',
        name: 'Broccoli, raw',
        kind: 'generic',
        brandOwner: null,
        brandName: null,
        description: null,
        barcode: null,
        nutrients: [],
        portions: [],
        itemVersion: null,
        ...overrides,
    };
}
