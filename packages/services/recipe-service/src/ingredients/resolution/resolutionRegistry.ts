/**
 * THE CASCADE REGISTRY — the ordered chain `IngredientsService` is wired with (plan U10 / R11, R12, R19).
 *
 * DESIGN PATTERN: **Registry over the Chain of Responsibility's ordered Strategies.** ⛔ THE ORDER IS THE
 * CONFIGURATION — it is a PRECEDENCE, not an implementation detail — which is why it lives as one explicit,
 * readable array rather than being assembled inside the service or sorted at runtime. It lives HERE, beside
 * the tiers, rather than in the module wiring, so the guard that checks it can read the array production
 * actually uses instead of a copy: a copy of a list cannot detect that the list changed
 * (`packages/infra/alb/listenerPriority.ts`, `packages/infra/global/__tests__/natEgressConsumers.test.ts`).
 *
 * ## ⛔ THE ORDER IS `[curated, memo, lexical]`, AND IT IS NOT R11's LITERAL ORDER — read this before
 * "restoring" it
 *
 * R11 names four tiers "in order: curated mappings, lexical ranking, knowledge base, LLM", and this registry
 * shipped in exactly that order. That order was only coherent alongside R12's second fall-through condition
 * — "each tier falls through only on a miss **or on confidence below its threshold**". KTD-A then removed
 * tier 2's threshold on purpose: `decideLexicalTier` proposes its top candidate on ANY non-empty candidate
 * set, because under withhold semantics a wrong top hit costs a `pending-verification` line and one gate
 * call, never a published wrong bind. Safety moved to the gate — and the ordering premise moved with it.
 *
 * What was left was a chain in which **the memo tier was reachable only when the catalog returned nothing at
 * all**. For every phrase the catalog can find — which is the overwhelming majority — it was dead.
 *
 * ⛔ AND IT WAS NOT LATENT. `ingredient_resolution_memos` has a LIVE writer: `verifyLine.ts` in
 * `packages/services/recipe-workers` calls `rememberAgreement` on every `band === 'verified'` identity
 * `agree`, from a deployed Lambda. So in every stage where the gate has run, a gate-agreed memo was already
 * being silently overruled by whatever the catalog ranked first — a wrong answer that looks like a working
 * system. It also made AE8 ("a phrase not present verbatim in the knowledge base, but a near-twin of a stored
 * phrase, resolves from the knowledge base **without an LLM call**") unreachable in practice, since a
 * near-twin's catalog search nearly always returns something.
 *
 * So the precedence is re-derived from what the evidence IS, and recorded as
 * `RESOLUTION_TIER_EVIDENCE` so it can be checked rather than merely asserted:
 *
 *  1. **curated** — `curated-mapping`. A person said what this phrase means (R19).
 *  2. **memo** — `remembered-verification`. A row recording that the verification gate AGREED an identity;
 *     the writer's `AgreementRow.modelId` (`recipe-workers`' `verification/verdictStore.ts` — the only writer
 *     of this table) is REQUIRED, so such a row cannot exist without that agreement. ⚠️ That is a
 *     fact about the STORED key, which is exactly why `decideMemoTier` answers only on an EXACT key and
 *     defers the k-NN branch — read its docstring before changing either.
 *  3. **lexical** — `catalog-ranking`. KTD-A's own words: ZERO initial authority. It is the gate's INPUT.
 *
 * Believing (3) over (2) replaces a settled answer with an unsettled one and pays for a gate call to
 * re-decide a question already decided. It is also the more expensive order: two local indexed reads are
 * cheaper than one or two cross-service searches. ⚠️ The cost agreement is a convenience, not the
 * justification — where the two ever disagree, precedence wins, because consulting a later-precedence source
 * first is not an optimisation, it is a different answer.
 *
 * ### The three repairs that were considered and rejected
 *
 *  - **Give tier 2 a confidence threshold again.** This is undoing KTD-A rather than living with it, and the
 *    threshold would be a number invented here — R16 ("an ordinal ranking score is not a confidence value
 *    until the document says how it becomes one") and R17 ("bands are MEASURED, not chosen") both forbid
 *    that. Earned autonomy (plan U3) is where a lexical bind acquires the right to skip, from measured band
 *    statistics; a constant typed in here would be a second, unmeasured authority beside it.
 *  - **Make tier 2 defer when a memo exists.** This breaks the chain's own contract — a link would have to
 *    know about a later link — duplicates the memo read inside the lexical tier, and puts a precedence rule
 *    inside a Strategy whose job is retrieval. Precedence belongs to the registry, which is this file.
 *  - **Reorder and say nothing.** The order would be right and still uncheckable, which is how it went wrong
 *    the first time.
 *
 * ## The absentee, absent for a stated reason
 *
 * **Tier 4, the LLM gate, is NOT A TIER OF THIS CHAIN AT ALL** — corrected 2026-08-22, when its producer
 * shipped. KTD-3 is "the verification gate, NOT a residual fallback": the model verifies what is about to be
 * PUBLISHED, whereas a tier here is consulted precisely when the earlier tiers have all passed, i.e. when
 * there is nothing resolved to verify. Its producer lives on the RECIPE write path, the only layer holding
 * the recipe id, the raw source line, the parsed quantity and the resolved food together — see
 * `recipes/domain/verificationRequests.ts`. `evidenceClassOf('llm')` is `undefined` for exactly this reason, and
 * registering it here is a defect the guard reads rather than a reordering nobody notices.
 *
 * ## ⚠️ WHAT THIS ORDER COSTS — three consequences, recorded rather than discovered later
 *
 *  1. **⛔ THE NEAR-MEMO BRANCH HAD TO BE CLOSED IN THE SAME CHANGE — see `decideMemoTier`.** `findMemo`
 *     answers on an exact key OR a trigram neighbour at `MEMO_SIMILARITY_FLOOR` (0.5), and the tier used to
 *     return `resolved` for both. `verifiedBy` is a fact about the STORED key, so on the near branch nobody
 *     ever agreed that the QUERY phrase means that food. Downstream, `pendingStateOf`
 *     (`recipes/domain/lineVerification.ts`) withholds only `tier === 'lexical'` and `pendingRedrives`
 *     (`recipes/domain/verificationRequests.ts`) is gated on `evidence.kind === 'ranked'` — both deliberate,
 *     both correct for an EXACT memo. Under the old order the near branch needed an empty catalog and was
 *     nearly unreachable; promoting this tier would have made it the COMMON path, publishing unverified,
 *     un-redriveable binds. So the near branch now PASSES and the phrase falls to the lexical tier, whose
 *     binds are withheld until a verdict lands. ⚠️ That defers AE8 and is the ONE open owner ruling in this
 *     change; `decideMemoTier`'s docstring carries the argument and the exact condition for reverting it
 *     (persist `MemoHit.match`, then teach the two predicates above that a near memo withholds — ADR-0026
 *     §3's `single-engine` is not `differ`, one field over).
 *  2. **A stale memo now costs a request its lexical answer.** `resolveThroughCascade` treats a food it
 *     cannot admit as a miss and returns `undefined`; it does NOT resume the chain. So a memo naming a food
 *     U12's reseed killed drops the request to the ordinary `foodClient.addByName` path rather than to the
 *     lexical tier. ACCEPTED, not overlooked: `curatedTier.ts`'s header already takes this position for tier
 *     1 for the same reason (checking existence inside a tier means a cross-service round trip to answer a
 *     question the caller is about to answer anyway), the fallback is exactly the pre-cascade behaviour, and
 *     making inadmissibility resume the chain would give the cascade knowledge of admission. Pinned by the
 *     integration suite so it stays a decision.
 *  3. **⚠️ Band populations change shape, and that is an OPEN calibration question (plan U3, R17).**
 *     `bandKeyOf` only produces a key for `tier === 'lexical'`, so a memo win contributes no band
 *     observation and can never earn a band skip. With repeat phrases now absorbed by the memo tier, band
 *     statistics accrue from FIRST-TIME phrases only: autonomy is earned more slowly. The counter-argument
 *     is that N observations of one popular phrase INFLATE a band's record, so deduplicating is arguably
 *     more honest against R17's "measured, not chosen". Either way it changes the sample the bands are
 *     calibrated on, and it is the owner's ruling to make, not this file's.
 *
 * ⚠️ Cost, minor and priced: `findMemo` issues two statements on a miss (exact, then the GiST k-NN scan), so
 * every non-curated `addByName` now pays them before reaching the catalog. Two local indexed reads against
 * one or two cross-service searches under a 600ms budget — the order is cheaper on a hit and marginally
 * dearer on a full miss.
 *
 * ## ⛔ THE CASCADE'S REACH IS THE WRITE PATH, AND ONLY THE WRITE PATH — unchanged by any of the above
 *
 * `resolveThroughCascade` has exactly one caller: `IngredientsService.addByName`. The cascade is deliberately
 * NOT wired into `GET /api/v1/ingredients/suggest`, `GET /api/v1/ingredients/search/live`, or
 * `POST /api/v1/ingredients/:id/resolve`. R13 is explicit that only the lexical tier runs synchronously on
 * the search-ahead, and the read surfaces have their own shapes: `suggest` is a per-keystroke blend under a
 * sub-second budget, `search/live` is an on-demand source search, and `:id/resolve` is a user's own pick —
 * an answer, not a question. Reordering the tiers changes nothing about that; do not treat "the memo tier is
 * cheap now" as a licence to add the cascade to a read path.
 */
import type { FoodCatalogGateway } from '../foodCatalog.gateway.js';
import { createCuratedTier } from './curatedTier.js';
import { createLexicalTier } from './lexicalTier.js';
import { createMemoTier } from './memoTier.js';
import type { ResolutionMappingsDal } from './resolutionMappings.dal.js';
import type { ResolutionTier } from './resolutionCascade.js';

/**
 * Build the cascade in precedence order.
 *
 * ⛔ The order in the returned array is the whole point of this module — read the file docstring before
 * changing it, and note that `__tests__/resolutionRegistry.test.ts` checks it against the evidence-class
 * ladder in `resolutionCascade.ts` rather than against a copy of the literal.
 *
 * @param mappings - The knowledge-base repository the curated and memo tiers read through.
 * @param catalog - The availability-disciplined search gateway the lexical tier retrieves through (plan U4).
 * @returns The tiers, in precedence order. Pure — each tier is constructed, none is consulted.
 */
export function createResolutionRegistry(
    mappings: ResolutionMappingsDal,
    catalog: FoodCatalogGateway,
): readonly ResolutionTier[] {
    return [createCuratedTier(mappings), createMemoTier(mappings), createLexicalTier(catalog)];
}
