/**
 * THE CASCADE REGISTRIES — the ordered chains production runs (plan U10 / R11, R12, R19; ADR-0071).
 *
 * ## ⛔ TWO CHAINS, because binding and proposing are different acts (ADR-0071)
 *
 *  - {@link createBindingRegistry} = `[curated, memo]` — what `POST /api/v1/ingredients/by-name` runs. That path
 *    BINDS, so only SETTLED evidence may answer: a person's ruling or a gate-agreed memo. The lexical tier left it
 *    after a production paste bound "milk" to milk crackers (ADR-0071 records why). A phrase neither tier knows falls
 *    through to food's own add-by-name, as it always has.
 *  - {@link createProposalRegistry} = `[curated, memo, lexical]` — what the paste-job matcher runs. It never binds:
 *    it stores a PROPOSAL that the cook confirms and the gate reviews, so a ranked guess is a fine thing to offer.
 *
 * Both are held to the precedence ladder below by the same guard (`resolutionRegistry.test.ts`, parametrized over
 * both). The binding chain is a prefix of the proposal chain, so their order cannot disagree.
 *
 * DESIGN PATTERN: **Registry over the Chain of Responsibility's ordered Strategies.** ⛔ THE ORDER IS THE
 * CONFIGURATION — it is a PRECEDENCE, not an implementation detail — which is why it lives as one explicit,
 * readable array rather than being assembled inside the service or sorted at runtime. It lives HERE, beside
 * the tiers, rather than in the module wiring, so the guard that checks it can read the array production
 * actually uses instead of a copy: a copy of a list cannot detect that the list changed
 * (`shared/infra/src/alb/listenerPriority.ts`, `packages/tools/repoGuards/__tests__/natEgressConsumers.test.ts`).
 *
 * ## ⛔ THE ORDER IS `[curated, memo, lexical]`, AND IT IS NOT R11's LITERAL ORDER — read this before
 * "restoring" it
 *
 * R11 names four tiers "in order: curated mappings, lexical ranking, knowledge base, LLM", and this registry
 * shipped in exactly that order. That order was only coherent alongside R12's second fall-through condition
 * — "each tier falls through only on a miss **or on confidence below its threshold**". KTD-A then removed
 * tier 2's threshold on purpose: `decideLexicalTier` proposes its top candidate on ANY non-empty candidate
 * set. That is safe only where a proposal binds nothing, which is why the lexical tier now sits in the proposal
 * chain alone (ADR-0071) — and the ordering premise moved with it.
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
 *    that. Measured band statistics (plan U3) are where a skip would be earned, and that subsystem is dormant
 *    by decision (ADR-0071); a constant typed in here would be a second, unmeasured authority beside it.
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
 *     ever agreed that the QUERY phrase means that food. Under ADR-0071's two chains a resolved near memo would
 *     bind a guess with settled authority (by-name) or propose it as a `confident` remembered match (the paste
 *     matcher). So the near branch PASSES. ⚠️ That defers AE8 and is the ONE open owner ruling here;
 *     `decideMemoTier`'s docstring carries the argument and the condition for reverting it.
 *  2. **A stale memo now costs a request its lexical answer.** `resolveThroughCascade` treats a food it
 *     cannot admit as a miss and returns `undefined`; it does NOT resume the chain. So a memo naming a food
 *     U12's reseed killed drops the request to the ordinary `foodClient.addByName` path rather than to the
 *     lexical tier. ACCEPTED, not overlooked: `curatedTier.ts`'s header already takes this position for tier
 *     1 for the same reason (checking existence inside a tier means a cross-service round trip to answer a
 *     question the caller is about to answer anyway), the fallback is exactly the pre-cascade behaviour, and
 *     making inadmissibility resume the chain would give the cascade knowledge of admission. Pinned by the
 *     integration suite so it stays a decision.
 *  3. **⚠️ Band calibration (plan U3, R17) is dormant by decision (ADR-0071).** No band is observed from a memo win,
 *     and none from anything else while no producer names a band; the question of which phrases a band should be
 *     calibrated on reopens when the paste origin carries the match row's band key (ADR-0071 records it).
 *
 * ⚠️ Cost, minor and priced: `findMemo` issues two statements on a miss (exact, then the GiST k-NN scan), so
 * every non-curated `addByName` now pays them before reaching the catalog. Two local indexed reads against
 * one or two cross-service searches under a 600ms budget — the order is cheaper on a hit and marginally
 * dearer on a full miss.
 *
 * ## ⛔ THE CASCADE'S REACH IS THE WRITE PATH AND THE PASTE MATCHER, AND NOTHING ELSE
 *
 * The binding chain has exactly one caller, `IngredientsService.addByName`; the proposal chain has one,
 * `MatchProposalService`. The cascade is deliberately
 * NOT wired into `GET /api/v1/ingredients/search`. R13 is explicit that only the lexical tier runs synchronously on the
 * search-ahead, and `/search` is the filter's read of bound foods. Reordering the tiers changes nothing about that; do
 * not treat "the memo tier is cheap now" as a licence to add the cascade to a read path.
 */
import type { FoodCatalogGateway } from '../foodCatalog.gateway.js';
import { createCuratedTier } from './curatedTier.js';
import { createLexicalTier, type LexicalTierObserver } from './lexicalTier.js';
import { createMemoTier } from './memoTier.js';
import type { ResolutionMappingsDal } from './resolutionMappings.dal.js';
import type { ResolutionTier } from './resolutionCascade.js';

/** DI token for the proposal chain, which `IngredientsModule` provides and the paste matcher consumes. */
export const PROPOSAL_TIERS = 'RESOLUTION_PROPOSAL_TIERS';

/**
 * Build the BINDING chain: settled evidence only, in precedence order (ADR-0071).
 *
 * ⛔ No `catalog-ranking` tier may join it: this chain's answer is bound for the cook with no review in between.
 * `resolutionRegistry.test.ts` asserts that, and the precedence, against the array returned here.
 *
 * @param mappings - The knowledge-base repository the curated and memo tiers read through.
 * @returns The tiers, in precedence order. Pure — each tier is constructed, none is consulted.
 */
export function createBindingRegistry(mappings: ResolutionMappingsDal): readonly ResolutionTier[] {
    return [createCuratedTier(mappings), createMemoTier(mappings)];
}

/**
 * Build the PROPOSAL chain: the binding chain, then the lexical shortlist (ADR-0071).
 *
 * ⛔ The order in the returned array is the whole point of this module — read the file docstring before
 * changing it, and note that `__tests__/resolutionRegistry.test.ts` checks it against the evidence-class
 * ladder in `resolutionCascade.ts` rather than against a copy of the literal.
 *
 * @param mappings - The knowledge-base repository the curated and memo tiers read through.
 * @param catalog - The availability-disciplined search gateway the lexical tier retrieves through (plan U4).
 * @param lexicalObserver - Where the lexical tier reports name hits that arrived with no rung.
 * @returns The tiers, in precedence order. Pure — each tier is constructed, none is consulted.
 */
export function createProposalRegistry(
    mappings: ResolutionMappingsDal,
    catalog: FoodCatalogGateway,
    lexicalObserver: LexicalTierObserver,
): readonly ResolutionTier[] {
    return [...createBindingRegistry(mappings), createLexicalTier(catalog, lexicalObserver)];
}
