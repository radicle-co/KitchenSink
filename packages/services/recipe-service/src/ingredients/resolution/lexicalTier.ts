/**
 * TIER 2 of the resolution cascade — the lexical shortlist-builder (plan U4 / origin R1, KTD-A).
 *
 * DESIGN PATTERN: **Strategy**, split into a pure `decide` and an impure adapter — the `curatedTier.ts` /
 * `memoTier.ts` convention (pure `decide` + impure `evaluate`, as in `deploy-gate.sh`).
 *
 * ## ⛔ ZERO INITIAL AUTHORITY — the tier has NO confidence threshold, deliberately
 *
 * The tier proposes its top-ranked candidate on ANY non-empty candidate set. That looks reckless next to
 * the owner's "very clear go and no go" constraint until the second half is in view: a lexical resolution
 * carries `ranked` evidence, and under KTD-A every zero-authority lexical bind WITHHOLDS as
 * `pending-verification` until the verification gate agrees — so a wrong top hit costs a pending line and
 * one gate call (~$0.000034), never a published wrong bind. Safety lives at the gate; what this tier owes
 * it is EVIDENCE: the structured shortlist, the measured margin, and the top hit's ladder rung — the band
 * key under which skips are later EARNED (plan U3), not designed in here.
 *
 * ## Ranking is the CATALOG's, re-derived only for the rung label
 *
 * `FoodCatalogGateway.search` returns hits already ordered by food-service's tiered relevance (the shared
 * ladder, U1's `rank_head` included) and re-sorted by score at the gateway. This tier does not re-rank;
 * it reads the order and CLASSIFIES the top hit against the same shared ladder so the rung stored in the
 * event log is the rung the ranking actually used.
 *
 * ## The synonym-reformulation retry (origin D11)
 *
 * On an empty or all-`base` candidate set the tier retries ONCE through a small curated synonym map
 * ("aubergine" → "eggplant"): deterministic, no LLM, one extra query. The map is a vocabulary, not a
 * tagger — entries are added by a human who has seen the miss, the same discipline as
 * `modifierLexicon.ts` (ADR-0026).
 *
 * ## Availability discipline
 *
 * A catalog that could not be searched is "we could not look", never "we looked and found nothing": the
 * adapter THROWS on `unavailable`, so the cascade records the tier under `unavailable` and a caller
 * writing terminal statuses knows the difference (the cascade's own containment rule). An operator's
 * `disabled` switch is a PASS — a switched-off blend is not an outage. An unattended import (no caller)
 * reaches the gateway, which degrades to `unavailable` without issuing a request (#120's rule: the call
 * is made AS the caller or not at all) — so imports fall through to the food service exactly as before.
 *
 * ## R20 private-food scoping (stub)
 *
 * Private authored foods (plan U10/U18) must appear only for their author. The search is food-service's,
 * so the scoping predicate will ride the search request when authored foods exist; until then the catalog
 * holds only public rows and there is nothing to scope. `ResolutionContext.userId` is already threaded
 * here for that day.
 */
import { classifyRankTier } from '@kitchensink/recipe-core/resolution/ranking-tiers';
import { describeRankingName, describeRankingQuery } from '@kitchensink/recipe-core/resolution/ranking-terms';
import type { ScoredCandidate } from '@kitchensink/recipe-core/resolution/verification-gate-policy';

import type { CatalogHit } from '../ingredientSuggestion.js';
import type { FoodCatalogGateway } from '../foodCatalog.gateway.js';
import type { ResolutionTier, TierOutcome } from './resolutionCascade.js';

/**
 * How many candidates the shortlist keeps. Far below the queue's `MAX_VERIFICATION_SHORTLIST` (25); five
 * is what the gate's nutrient-agreement check and a future disambiguation picker can actually use.
 */
export const LEXICAL_SHORTLIST_LIMIT = 5;

/**
 * The curated synonym map (origin D11). Keys and values are single lowercase tokens; multi-token phrases
 * are reformulated token-wise.
 *
 * ⛔ A VOCABULARY, not an algorithm: entries are added by a human who has seen the miss in a corpus diff,
 * never inferred. Keep it small — every entry is a claim that two words name the same food everywhere.
 */
const LEXICAL_SYNONYMS: ReadonlyMap<string, string> = new Map([
    ['aubergine', 'eggplant'],
    ['courgette', 'zucchini'],
    ['rocket', 'arugula'],
    ['coriander', 'cilantro'],
    ['beetroot', 'beets'],
    ['scallion', 'green onion'],
]);

/**
 * Reformulate a phrase through the synonym map.
 *
 * @param phrase - The raw ingredient phrase.
 * @returns The reformulated phrase, or `undefined` when the map changes nothing. Pure.
 */
export function reformulateQuery(phrase: string): string | undefined {
    let changed = false;
    const tokens = phrase
        .toLowerCase()
        .split(/\s+/)
        .map((token) => {
            const mapped = LEXICAL_SYNONYMS.get(token);

            if (mapped === undefined) {
                return token;
            }

            changed = true;

            return mapped;
        });

    return changed ? tokens.join(' ') : undefined;
}

/** The top hit's ladder rung for this query. Pure. */
function rungOf(phrase: string, hit: CatalogHit): string {
    return classifyRankTier(describeRankingName(hit.name), describeRankingQuery(phrase));
}

/**
 * Whether the candidate set earns a reformulation retry: empty, or nothing structural matched.
 *
 * @param phrase - The query phrase.
 * @param hits - The ranked hits.
 * @returns Whether to retry through the synonym map. Pure.
 */
export function shouldReformulate(phrase: string, hits: readonly CatalogHit[]): boolean {
    return hits.length === 0 || hits.every((hit) => rungOf(phrase, hit) === 'base');
}

/**
 * Decide what a ranked candidate set means. Pure.
 *
 * @param phrase - The query phrase (for rung classification and evidence).
 * @param hits - The ranked hits, highest score first (the gateway's order).
 * @returns A resolution proposing the top hit with its evidence, or a pass on an empty set.
 */
export function decideLexicalTier(phrase: string, hits: readonly CatalogHit[]): TierOutcome {
    const top = hits[0];

    if (top === undefined) {
        return { kind: 'pass', tier: 'lexical', reason: 'The catalog offered no candidates for this phrase.' };
    }

    const runnerUp = hits[1];
    const margin = runnerUp === undefined ? undefined : top.score - runnerUp.score;
    const rung = rungOf(phrase, top);
    const shortlist: ScoredCandidate[] = hits.slice(0, LEXICAL_SHORTLIST_LIMIT).map((hit) => ({
        foodId: hit.foodId,
        score: hit.score,
        // Absent stays absent — the gate reads a missing macro as UNKNOWN agreement, which fails toward
        // verify (D4a's second conjunct can only ever be satisfied by real stored values).
        ...(hit.energyKcalPer100g === undefined ? {} : { energyKcalPer100g: hit.energyKcalPer100g }),
        ...(hit.proteinGPer100g === undefined ? {} : { proteinGPer100g: hit.proteinGPer100g }),
        ...(hit.fatGPer100g === undefined ? {} : { fatGPer100g: hit.fatGPer100g }),
        ...(hit.carbohydrateGPer100g === undefined ? {} : { carbohydrateGPer100g: hit.carbohydrateGPer100g }),
    }));

    return {
        kind: 'resolved',
        tier: 'lexical',
        foodId: top.foodId,
        evidence: `lexical shortlist (rung ${rung}, ${String(hits.length)} candidates, margin ${
            margin === undefined ? 'none' : margin.toFixed(3)
        })`,
        confidence: margin,
        shortlist,
        rung,
    };
}

/**
 * Build tier 2 over the catalog gateway.
 *
 * @param gateway - The availability-disciplined food-service search gateway.
 * @returns The tier, ready for index 1 of the cascade's ordered registry.
 */
export function createLexicalTier(gateway: FoodCatalogGateway): ResolutionTier {
    return {
        id: 'lexical',
        /**
         * @param query - The phrase and its key.
         * @param context - The requesting user and their credential (or their absence — see the file doc).
         * @returns This tier's verdict.
         * @throws When the catalog was UNAVAILABLE — so the cascade records "could not look".
         * @sideEffect One or two authenticated, short-timeout food-service search requests.
         */
        resolve: async (query, context) => {
            const first = await gateway.search(context.caller, query.phrase, LEXICAL_SHORTLIST_LIMIT, {
                withNutrition: true,
            });

            if (first.availability === 'disabled') {
                return { kind: 'pass', tier: 'lexical', reason: 'The catalog blend is disabled by the operator.' };
            }

            if (first.availability === 'unavailable') {
                throw new Error('The food catalog was unavailable; the lexical tier could not look.');
            }

            if (!shouldReformulate(query.phrase, first.hits)) {
                return decideLexicalTier(query.phrase, first.hits);
            }

            const reformulated = reformulateQuery(query.phrase);

            if (reformulated === undefined) {
                return decideLexicalTier(query.phrase, first.hits);
            }

            const second = await gateway.search(context.caller, reformulated, LEXICAL_SHORTLIST_LIMIT, {
                withNutrition: true,
            });

            if (second.availability !== 'ok' || second.hits.length === 0) {
                // The retry is best-effort: a degraded or empty second pass falls back to whatever the
                // first pass held, judged on its own merits.
                return decideLexicalTier(query.phrase, first.hits);
            }

            const outcome = decideLexicalTier(reformulated, second.hits);

            if (outcome.kind === 'resolved') {
                return {
                    ...outcome,
                    evidence: `${outcome.evidence} — reformulated '${query.phrase}' → '${reformulated}'`,
                };
            }

            return outcome;
        },
    };
}
