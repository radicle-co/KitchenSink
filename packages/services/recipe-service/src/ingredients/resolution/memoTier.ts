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
 * ⛔ THE WRITER IS NOT IN THIS PACKAGE. `ingredient_resolution_memos` is populated by
 * `packages/services/recipe-workers/src/handlers/verifyLine.ts` (`deps.store.rememberAgreement` →
 * `verification/verdictStore.ts`), on every `band === 'verified'` identity `agree` for a non-private food.
 * That is a deployed Lambda, so this table is NOT empty, and the near-match hazard below is a live one rather
 * than a future precondition.
 *
 * ⚠️ `ResolutionMappingsDal` is READ-ONLY over this table, deliberately: this service holds no
 * `bedrock:InvokeModel` grant, so it can never hold the agreement a memo records, and a second, uncalled writer
 * of the same statement is the shape that drifts.
 */
import type { MemoHit, ResolutionMappingsDal } from './resolutionMappings.dal.js';
import type { ResolutionTier, TierOutcome } from './resolutionCascade.js';

/**
 * Decide what a memo lookup means. Pure.
 *
 * ## ⛔ ONLY AN EXACT KEY ANSWERS — the near branch DEFERS, and that is a safety rule, not a simplification
 *
 * A memo's `verified_by` is a fact about the STORED key. On the k-NN branch nobody — no human, no model —
 * ever agreed that the phrase being ASKED about means this food, so a near hit is a retrieval guess of the
 * same epistemic class as a lexical top hit, at a floor (`MEMO_SIMILARITY_FLOOR = 0.5`) the DAL's own
 * docstring calls the midpoint of the trigram scale.
 *
 * Against ADR-0071's two chains, a near memo that RESOLVED would be wrong in both. In the BINDING chain
 * (`[curated, memo]`, by-name) it would bind a retrieval guess with settled-evidence authority: nothing downstream holds
 * a memo bind back, so it would publish a wrong food at once. In the PROPOSAL chain (the paste matcher) it would be
 * proposed as `memo`, which `matchStateOf` reads as `confident` (a remembered match is settled), auto-selecting a guess
 * for the cook. PASSING instead hands the phrase on: by-name falls through to food's own add by name, and the paste
 * matcher reaches the lexical tier, whose proposal binds nothing and is reviewed by the gate on identity.
 *
 * ⚠️ This became load-bearing when the memo tier was promoted ahead of the lexical tier
 * (`resolutionRegistry.ts`): before that, the near branch needed an empty catalog and was nearly
 * unreachable; after it, it would have been the common path.
 *
 * ⚠️ **A DEFERRAL OF AE8, NOT A REJECTION OF IT — and the one open owner ruling here.** AE8 wants a near-twin
 * to resolve from the knowledge base without an LLM call. R14's "equality-only matching does not satisfy this
 * requirement" is still honoured: `findMemo`'s exact-then-k-NN lookup is UNCHANGED, and only this tier's
 * verdict on its result moved. Flip the near branch back to `resolved` the day a near hit can travel as its own
 * evidence class: a proposal state that reads it as unsettled, and a binding chain that does not bind it. The precedent
 * is ADR-0026 §3, `single-engine` is not `differ`, one field over.
 *
 * @param hit - The remembered resolution, or `undefined` when nothing is remembered close enough.
 * @returns A resolution naming the remembered food on an EXACT key; a pass otherwise.
 */
export function decideMemoTier(hit: MemoHit | undefined): TierOutcome {
    if (hit === undefined) {
        return { kind: 'pass', tier: 'memo', reason: 'Nothing remembered for this phrase or a close neighbour.' };
    }

    if (hit.match !== 'exact') {
        // Reported, never silent: a near hit that read as "nothing remembered" would hide the deferral from
        // anyone auditing why a line did not resolve at the knowledge base.
        return {
            kind: 'pass',
            tier: 'memo',
            reason:
                `A ${hit.match} memo match (similarity ${hit.similarity.toFixed(2)}) is not an agreement ` +
                'about this phrase; deferring to a tier whose binds are withheld until verified.',
        };
    }

    return {
        kind: 'resolved',
        tier: 'memo',
        // A root, or the variant the gate agreed for a variant-bound line (curated U9).
        food: hit.food,
        // How it matched, and how closely — kept even though only `exact` reaches here, so the day the near
        // branch is admitted a later audit of "why did this line resolve here?" already has more than a food
        // id to go on.
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
