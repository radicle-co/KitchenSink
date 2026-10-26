/**
 * THE LAST tier of the paste matcher's PROPOSAL chain — the lexical shortlist-builder (plan U4 / origin R1; ADR-0071).
 *
 * DESIGN PATTERN: **Strategy**, split into a pure `decide` and an impure adapter — the `curatedTier.ts` /
 * `memoTier.ts` convention (pure `decide` + impure `evaluate`, as in `deployGate.sh`).
 *
 * ## ⛔ ZERO AUTHORITY — the tier has NO confidence threshold, deliberately
 *
 * The tier proposes its top-ranked candidate on ANY non-empty candidate set. That is safe for one reason only, and
 * it is a structural one (ADR-0071's two chains): this tier sits in the PROPOSAL chain, which binds NOTHING. By-name
 * binds through the settled chain `[curated, memo]` and never reaches it. A lexical top hit becomes a stored proposal
 * the cook confirms, reviewed by the gate on identity, so a wrong top hit costs a `checking` or `needsChoice` line and
 * one gate call, never a wrong bind. What this tier owes the matcher is EVIDENCE: the shortlist (the cook's
 * candidates), the measured margin, and the top hit's ladder rung (`default` among them decides the line's state).
 *
 * ⛔ Do NOT wire it into a binding chain to "help" a phrase nobody has curated: the pending state that once made a bound
 * lexical guess safe read a row every cook shares, and it was removed (ADR-0071).
 *
 * ⛔ **THAT IS ALSO WHY IT RUNS LAST, and why R11's literal "curated, lexical, knowledge base" order is NOT
 * what ships.** A tier that answers on any non-empty candidate set consumes every query the catalog can
 * match, so anything registered behind it is unreachable in practice. This tier's evidence class is
 * `catalog-ranking` — the gate's INPUT — and it is registered after every tier whose evidence is already
 * settled. See `resolutionRegistry.ts` for the full argument and `resolutionCascade.ts`'s evidence-class
 * ladder for the machine-checked form of it; do not move this tier forward to "match R11".
 *
 * ## Ranking AND the rung are the CATALOG's
 *
 * `FoodCatalogGateway.search` returns hits already ordered by food-service's tiered relevance and re-sorted by
 * score at the gateway, each carrying the rung food ranked it on (ADR-0070). This tier neither re-ranks nor
 * re-classifies: it passes the published rung on, so the rung a proposal records is the rung the ranking used.
 *
 * ## The synonym-reformulation retry (origin D11)
 *
 * On an empty candidate set, or one where no hit is KNOWN to match structurally (every hit `base` or carrying no
 * rung), the tier retries ONCE through a small curated synonym map ("aubergine" → "eggplant"): deterministic, no
 * LLM, one extra query. A crosswalk hit (no rung, score 1) never earns a retry. The map is a vocabulary, not a
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
 * ## R20 private-food scoping — enforced one service over
 *
 * ⚠️ The catalog DOES hold private rows, and this tier is not a stub. Do NOT add a scoping predicate here: it
 * would be a second, weaker copy of a boundary that already exists at the only layer that can enforce it.
 *
 * The predicate is food-service's own: `foodSearch.dao.ts` admits `user_id IS NULL OR user_id = :caller`, so
 * a stranger's search can never RECEIVE another user's authored row. That is why the call goes out AS the
 * caller (#120) rather than under a service credential — the forwarded bearer IS the scoping argument.
 * Nothing here re-filters, because a row this tier can see is a row the caller was entitled to see.
 *
 * What this tier owes R20 is the SIGNAL, not the filter: {@link isAuthorAugmented} flags a shortlist containing the
 * caller's own `private` hit, so margins drawn from one user's catalog are never mistaken for facts about the shared
 * ranker (plan U11). The band subsystem that would consume them is dormant by decision (ADR-0071).
 *
 * `ResolutionContext.userId` stays threaded for the tiers that key on an author (curated); this one keys on
 * the CREDENTIAL.
 */
import type { ScoredCandidate } from '@kitchensink/recipe-core/resolution/verification-gate-policy';

import type { CatalogHit, FoodCatalogGateway } from '../foodCatalog.gateway.js';
import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import type { ResolutionTier, TierOutcome } from './resolutionCascade.js';

/**
 * How many candidates the shortlist keeps. Far below the queue's `MAX_VERIFICATION_SHORTLIST` (25); five
 * is what the gate's nutrient-agreement check and a future disambiguation picker can actually use.
 */
const LEXICAL_SHORTLIST_LIMIT = 5;

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

/**
 * The score food gives an identifier (barcode or external key) crosswalk hit. `foodRelevance.ts` keeps every name hit
 * below it, so it is the one way to tell a crosswalk hit from a name hit whose rung is missing.
 */
const CROSSWALK_SCORE = 1;

/**
 * A hit that matched an identifier rather than a name. Food says so with `matchedBy` (ADR-0070), and that flag decides;
 * only a hit with no flag at all (an older food) falls back to "no rung, at the crosswalk score". Pure.
 */
function isCrosswalkHit(hit: CatalogHit): boolean {
    if (hit.matchedBy !== undefined) {
        return hit.matchedBy === 'identifier';
    }

    return hit.rung === undefined && hit.score >= CROSSWALK_SCORE;
}

/**
 * Whether a hit is KNOWN to have matched structurally: it carries a rung above `base`, or it is a crosswalk hit.
 *
 * ⛔ An absent rung below the crosswalk score is UNKNOWN, not structural. Food publishes no rung when it is older than
 * this service, and the food client reads a rung it does not know as absent. Treating unknown as structural would
 * switch the D11 retry off for every query the day food rolled back, with nothing to show it happened.
 *
 * @param hit - One ranked hit.
 * @returns Whether it is known to be a structural match. Pure.
 */
function isKnownStructural(hit: CatalogHit): boolean {
    return isCrosswalkHit(hit) || (hit.rung !== undefined && hit.rung !== 'base');
}

/**
 * Whether the candidate set earns a reformulation retry: empty, or no hit is KNOWN to be a structural match (every hit
 * is `base` or has an unknown rung). A crosswalk hit never earns a retry, since an identifier match is not a weak one.
 *
 * @param hits - The ranked hits, each with the rung food published.
 * @returns Whether to retry through the synonym map. Pure.
 */
export function shouldReformulate(hits: readonly CatalogHit[]): boolean {
    return !hits.some(isKnownStructural);
}

/**
 * How many hits are NAME hits that arrived with no rung. Each one means food sent no rung, or one this build cannot
 * read. The tier reports the count so the condition shows in logs and metrics instead of passing silently.
 *
 * @param hits - The ranked hits.
 * @returns The count of rung-less hits below the crosswalk score. Pure.
 */
export function countUnrankedHits(hits: readonly CatalogHit[]): number {
    return hits.filter((hit) => hit.rung === undefined && !isCrosswalkHit(hit)).length;
}

/** Where the tier reports what it saw that an operator needs to know. */
export interface LexicalTierObserver {
    /**
     * Called with the number of name hits that arrived with no rung, when there are any.
     *
     * Required, not optional-with-default, so no wiring acquires a silent tier by omission.
     */
    readonly onUnrankedHits: (count: number) => void;
}

/**
 * Whether ANY hit is the CALLER's own private authored food (U11/R20) — the band-exclusion trigger.
 *
 * ⛔ The whole shortlist, not the winner: a private row below the top hit still means these margins were
 * measured against a catalog nobody else has.
 *
 * @param hits - The ranked hits.
 * @returns Whether the shortlist is author-augmented. Pure.
 */
function isAuthorAugmented(hits: readonly CatalogHit[]): boolean {
    return hits.some((hit) => hit.visibility === 'private');
}

/** The food a hit names: its variant when food named exactly one (R23), else its root. Pure. */
function foodOfHit(hit: CatalogHit): FoodRef {
    return hit.variantId === undefined ? { kind: 'root', id: hit.foodId } : { kind: 'variant', id: hit.variantId };
}

/**
 * Decide what a ranked candidate set means. Pure.
 *
 * @param hits - The ranked hits, highest score first (the gateway's order).
 * @returns A resolution proposing the top hit with its evidence, or a pass on an empty set.
 */
export function decideLexicalTier(hits: readonly CatalogHit[]): TierOutcome {
    const top = hits[0];

    if (top === undefined) {
        return { kind: 'pass', tier: 'lexical', reason: 'The catalog offered no candidates for this phrase.' };
    }

    const runnerUp = hits[1];
    const margin = runnerUp === undefined ? undefined : top.score - runnerUp.score;
    const rung = top.rung;
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
        authorAugmented: isAuthorAugmented(hits),
        tier: 'lexical',
        // R23 (curated U9): food names a hit's variant only when the query names exactly one live variant of it, so
        // the top hit's variant IS "the words name exactly one variant". The shortlist above still ranks roots.
        food: foodOfHit(top),
        evidence: `lexical shortlist (rung ${rung ?? 'none'}, ${String(hits.length)} candidates, margin ${
            margin === undefined ? 'none' : margin.toFixed(3)
        })`,
        confidence: margin,
        shortlist,
        // ADR-0071: what the paste matcher offers the cook, each with the rung food ranked it on.
        candidates: hits.slice(0, LEXICAL_SHORTLIST_LIMIT).map((hit) => ({ food: foodOfHit(hit), rung: hit.rung })),
        rung,
    };
}

/**
 * Build the lexical tier over the catalog gateway.
 *
 * @param gateway - The availability-disciplined food-service search gateway.
 * @param observer - Where rung-less hits are reported.
 * @returns The tier, for the LAST slot of the cascade's ordered registry.
 */
export function createLexicalTier(gateway: FoodCatalogGateway, observer: LexicalTierObserver): ResolutionTier {
    /** Report rung-less hits; the report itself never fails a resolution. */
    const observe = (hits: readonly CatalogHit[]): void => {
        const unranked = countUnrankedHits(hits);

        if (unranked > 0) {
            try {
                observer.onUnrankedHits(unranked);
            } catch {
                // Observability must not become an availability dependency (the cascade's own rule).
            }
        }
    };

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

            observe(first.hits);

            if (!shouldReformulate(first.hits)) {
                return decideLexicalTier(first.hits);
            }

            const reformulated = reformulateQuery(query.phrase);

            if (reformulated === undefined) {
                return decideLexicalTier(first.hits);
            }

            const second = await gateway.search(context.caller, reformulated, LEXICAL_SHORTLIST_LIMIT, {
                withNutrition: true,
            });

            observe(second.hits);

            if (second.availability !== 'ok' || second.hits.length === 0) {
                // The retry is best-effort: a degraded or empty second pass falls back to whatever the
                // first pass held, judged on its own merits.
                return decideLexicalTier(first.hits);
            }

            const outcome = decideLexicalTier(second.hits);

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
