/**
 * TIER 1 of the resolution cascade — the curated mapping (plan U10 / R11, R19).
 *
 * DESIGN PATTERN: **Strategy**, split into a pure `decide` and an impure adapter — the convention this
 * repository already applies in `deploy-gate.sh` (pure `decide` + impure `evaluate`) and in
 * `evaluateProvenance` vs `RecipesService.create`. The judgement is exhaustible as a table; the adapter has
 * nothing left in it to get wrong but the query it issues, which is what its tests assert.
 *
 * R19 makes this tier outrank every other: a human said what this phrase means, and no ranking metric or
 * model output displaces that. Precedence WITHIN the tier — the caller's own correction ahead of the global
 * one — is expressed as the DAL's sort key rather than as logic here, so the answer comes from one indexed
 * read and cannot disagree with itself.
 *
 * ⛔ THIS TIER DOES NOT VERIFY THAT THE FOOD STILL EXISTS, deliberately. `food_id` has no foreign key and
 * U12's reseed mints fresh food ULIDs, so a mapping can name a food that is gone. Checking here would mean a
 * cross-service call inside a cascade tier — a per-resolution round trip to answer a question the CALLER is
 * about to answer anyway when it admits the food. The caller treats a non-admissible food as a miss and
 * continues; see `IngredientsService.addByName`.
 */
import type { MappingInForce, ResolutionMappingsDal } from './resolutionMappings.dal.js';
import type { ResolutionTier, TierOutcome } from './resolutionCascade.js';

/**
 * Decide what a curated-mapping lookup means. Pure.
 *
 * @param inForce - The mapping binding this phrase for this caller, or `undefined` when none does.
 * @returns A resolution naming the mapped food, or a pass.
 */
export function decideCuratedTier(inForce: MappingInForce | undefined): TierOutcome {
    if (inForce === undefined) {
        return { kind: 'pass', tier: 'curated', reason: 'No curated mapping binds this phrase for this caller.' };
    }

    return {
        kind: 'resolved',
        tier: 'curated',
        foodId: inForce.foodId,
        // The ORIGIN is in the evidence because the three are not equally strong claims: a curator's ruling,
        // two users agreeing, and one user's private note all resolve identically here but read very
        // differently in an audit of why a line landed where it did.
        evidence: `curated mapping (${inForce.scope}, origin ${inForce.origin})`,
    };
}

/**
 * Build tier 1 over the knowledge-base DAL.
 *
 * @param dal - The resolution-mappings repository.
 * @returns The tier, ready to be registered in the cascade's ordered array.
 */
export function createCuratedTier(dal: ResolutionMappingsDal): ResolutionTier {
    return {
        id: 'curated',
        /**
         * @param query - The phrase and its key.
         * @param context - The requesting user, or `undefined` for an unattended import (R22) — passed
         *   through UNCHANGED, because `undefined` means nobody is present and the DAL's predicate then shows
         *   the caller global mappings and nobody's personal ones.
         * @returns This tier's verdict.
         * @sideEffect Reads `ingredient_resolution_mappings`.
         */
        resolve: async (query, context) => decideCuratedTier(await dal.findInForce(query.key, context.authorId)),
    };
}
