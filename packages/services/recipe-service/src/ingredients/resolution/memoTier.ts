/**
 * THE MEMO TIER of the resolution cascade — the remembered resolution (plan U10 / R11, R14).
 *
 * ⚠️ Named, not numbered. It used to be "TIER 3" after R11's literal ordering; it is now consulted SECOND,
 * ahead of the lexical tier, and a positional name here would be a second representation of an order that
 * lives in `resolutionRegistry.ts` and is machine-checked there. A tier does not know its own index.
 *
 * DESIGN PATTERN: **Strategy**, split into a pure `decide` and an impure adapter, exactly as `curatedTier`
 * is and for the same reason.
 *
 * R14 requires the lookup to match "on a normalized key first and a nearest-neighbour search second", and
 * states that "equality-only matching does not satisfy this requirement". Both halves live in the DAL's ONE
 * query pair, because the nearest-neighbour half is an INDEXED k-NN scan (`ORDER BY normalized_key <-> $1`
 * over a GiST trigram index) and a tier that post-filtered in Node would have paid for a full answer it then
 * discarded.
 *
 * ⚠️ NOTHING IN U10 WRITES A MEMO, and that is the honest state rather than an oversight: a memo exists only
 * for a resolution the verification gate agreed with, and the gate is U11's. The tier ships now because it is
 * what U11 writes INTO — and because the bar on that write ("only a gate-agreed resolution, and record which
 * model agreed") is expressed as a required field on `VerifiedMemo` rather than as a sentence in a plan,
 * before there is a writer to forget it.
 */
import type { MemoHit, ResolutionMappingsDal } from './resolutionMappings.dal.js';
import type { ResolutionTier, TierOutcome } from './resolutionCascade.js';

/**
 * Decide what a memo lookup means. Pure.
 *
 * @param hit - The remembered resolution, or `undefined` when nothing is remembered close enough.
 * @returns A resolution naming the remembered food, or a pass.
 */
export function decideMemoTier(hit: MemoHit | undefined): TierOutcome {
    if (hit === undefined) {
        return { kind: 'pass', tier: 'memo', reason: 'Nothing remembered for this phrase or a close neighbour.' };
    }

    return {
        kind: 'resolved',
        tier: 'memo',
        foodId: hit.foodId,
        // How it matched, and how closely. R14's near-twin path is the one most likely to be wrong in a way
        // nobody notices, so a later audit of "why did this line resolve here?" needs more than a food id.
        evidence: `memo ${hit.match} match (similarity ${hit.similarity.toFixed(2)})`,
    };
}

/**
 * Build the memo tier over the knowledge-base DAL.
 *
 * @param dal - The resolution-mappings repository.
 * @returns The tier, ready to be registered in the cascade's ordered array.
 */
export function createMemoTier(dal: ResolutionMappingsDal): ResolutionTier {
    return {
        id: 'memo',
        /**
         * @param query - The phrase and its key. A memo is machine-derived and belongs to nobody, so the
         *   lookup takes the key alone — passing an author would imply a per-user memo table that does not
         *   exist.
         * @returns This tier's verdict.
         * @sideEffect Reads `ingredient_resolution_memos`.
         */
        resolve: async (query) => decideMemoTier(await dal.findMemo(query.key)),
    };
}
