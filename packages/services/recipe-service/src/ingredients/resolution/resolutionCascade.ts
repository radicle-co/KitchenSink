/**
 * THE RESOLUTION CASCADE — the object no unit previously owned (plan U10 / R11, R12, R22).
 *
 * DESIGN PATTERN: **Chain of Responsibility over ordered tier Strategies.** U5, U6, U10 and U11 each build a
 * TIER; until this module nothing ran them in order, decided when a tier had answered, or terminated the
 * chain — while U11's plan already spoke of "terminating the cascade" as though it existed. This is that
 * object, and it owns exactly ONE rule: **consult the tiers in order; the first tier that resolves wins, and
 * nothing after it is consulted at all.**
 *
 * ## ⛔ STATE OWNERSHIP, stated once because three packages straddle this seam
 *
 *  - **recipe-service owns THE CASCADE** — this module, its termination rule, the curated and memo tiers,
 *    and the ORDER, which lives in `resolutionRegistry.ts` and is checked against the evidence-class ladder
 *    declared below.
 *  - **food-service owns only the catalog-side Scoring Policy** it is queried through. The lexical tier is an
 *    adapter over a query to food-service and to this service's own `ingredients` table; the RANKING inside
 *    that query is food's and U5/U6's, never this module's.
 *  - **recipe-workers owns only GATE EXECUTION**, behind the shipped `PENDING → RESOLVED` lifecycle. The
 *    verification gate runs in a Lambda because ADR-0024 grants `bedrock:InvokeModel` to exactly one
 *    execution role, and recipe-service is not it.
 *
 * ## ⛔ THE VERIFICATION GATE IS NOT A TIER OF THIS CHAIN — corrected 2026-08-22, when its producer shipped
 *
 * An earlier revision of this file said tier 4 would be "an ENQUEUE rather than a synchronous answer" and
 * reserved a `deferred` member on {@link TierOutcome} for it. Both were wrong, and building them would have
 * left a named shape that lies.
 *
 * KTD-3 is titled "the verification gate, NOT a residual fallback", and its argument is that "a
 * tier-4-as-residual design never sees a confidently wrong answer, and every one of the ~900 bad `food_id`s
 * was confidently wrong — so the model verifies what is about to be PUBLISHED." The gate is therefore
 * POST-resolution by construction, while a tier of this chain is consulted precisely when tiers 1–3 have all
 * PASSED — i.e. when there is no `foodId`, no candidate name and no identity evidence to ask about. The
 * shipped contract agrees: `verifyIngredientLineMessage`'s `foodId` is `min(1)` and its `evidenceKind` is
 * closed over the three IDENTITY-ESTABLISHING tiers, with no member for "nothing resolved".
 *
 * The producer lives where every field the gate needs actually coexists — `RecipesService`, after the
 * ingredient rows are persisted. See `recipes/domain/verificationRequests.ts`. Do not reintroduce a
 * `deferred` outcome here: a tier that hands off and cannot answer has, from this chain's side, PASSED —
 * it merely did I/O on the way out — and giving `runResolutionCascade` a third outcome would force it to
 * decide a termination rule whose only coherent answer is the one `pass` already has.
 *
 * ## Why a tier reports a VERDICT and not a confidence number
 *
 * R16 says "an ordinal ranking score is not a confidence value until the document says how it becomes one",
 * and R17 says the bands are MEASURED, not chosen. A numeric scale invented here would therefore be a second
 * authoritative representation of a value the requirements insist has exactly one — derived from evidence
 * U10 does not have. So the chain does not carry a metric: each tier compares against its OWN threshold,
 * which it is the only thing that understands (exact key equality; trigram distance; a lexical margin; an
 * LLM band), and reports `resolved` or `pass`. That is Chain of Responsibility's actual contract — "handle,
 * or pass on" — and it is what lets U11 add a measured `confidence` to the `resolved` member without
 * reshaping the chain or any tier that does not use it.
 *
 * ## Failure is CONTAINED, and is never equated with a miss
 *
 * A tier that throws does not take the cascade down: the chain records it, reports it, and consults the next
 * one — a database blip on the mappings table must not make every ingredient unresolvable. But an exhausted
 * cascade carries `unavailable` separately from `consulted`, because "we could not look" and "we looked and
 * found nothing" lead a caller to opposite actions: one is retried, the other is written as a terminal
 * status. Collapsing them is how a transient degradation becomes a permanent fact about an ingredient.
 */
import type { NormalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';
import type { ScoredCandidate } from '@kitchensink/recipe-core/resolution/verification-gate-policy';

import type { CallerToken } from '../../auth/CallerToken.js';

/**
 * The four tier identifiers R11 names — as a SET, in no meaningful order.
 *
 * ⛔ This array's order is NOT the consultation order and never was authoritative: it contains `llm`, which
 * is deliberately not a tier of this chain at all, and it is also the domain of the persisted
 * `ingredient_resolutions.tier` CHECK. It once said "in the order R11 names them", which was decorative
 * then and is wrong now — see `resolutionRegistry.ts` for the real order and why it is not R11's literal
 * one. The identifier is a value, not a position: the registry that orders them is
 * {@link RESOLUTION_TIER_EVIDENCE}'s subject, so a tier that has not shipped is simply absent from the
 * registry array rather than a hole in it.
 */
export const RESOLUTION_TIER_IDS = ['curated', 'lexical', 'memo', 'llm'] as const;

/** Which tier produced an outcome. */
export type ResolutionTierId = (typeof RESOLUTION_TIER_IDS)[number];

/**
 * The ids that name a LINK OF THIS CHAIN.
 *
 * `llm` is excluded at the type level rather than by a runtime check, because the exclusion is a decision
 * this file already argues at length: the verification gate is POST-resolution and therefore has no
 * precedence relative to the tiers. `Exclude` keeps that decision exhaustive — a fifth member of
 * {@link RESOLUTION_TIER_IDS} lands in {@link RESOLUTION_TIER_EVIDENCE} as a COMPILE error until somebody
 * says where on the ladder it sits.
 */
export type CascadeTierId = Exclude<ResolutionTierId, 'llm'>;

/**
 * THE EVIDENCE CLASSES a tier retrieves from, in CONSULTATION-PRECEDENCE order — first is consulted first.
 *
 * ⛔ **THIS IS AN ORDERING KEY, NOT A TRUST LEVEL, and the distinction is load-bearing.** It answers "which
 * tier gets asked first"; it says nothing about whether the resulting bind may be PUBLISHED. Publish-trust
 * is KTD-A's question and it has its own home — `pendingStateOf` in `recipes/domain/lineVerification.ts`,
 * the policy layer ADR-0023 rules on. The two were nearly conflated here, and the conflation would have
 * made the type lie: a memo tier declared "gate-agreed" is telling the truth about its SOURCE and a lie
 * about its NEAR-match branch, where nobody ever agreed the query phrase means that food. Naming the
 * classes after the SOURCE keeps every branch of every tier honest.
 *
 * ⛔ The order is the repair for a real defect. The registry shipped as `[curated, lexical, memo]` —
 * R11's literal order, written when R12 still gave tier 2 a confidence threshold to fall through on. KTD-A
 * then removed that threshold (the lexical tier resolves on ANY non-empty candidate set, because a wrong
 * top hit costs a withheld `pending-verification` line rather than a published bind), and with it the only
 * route to the memo tier for any phrase the catalog can find. That tier was dead and nothing went red,
 * because the order was a literal nobody could compare against its own reason.
 *
 * The classes, and why they are in this order:
 *
 *  - **`curated-mapping`** — a person said what this phrase means. R19 puts it above every other tier: no
 *    ranking metric and no model output displaces a human ruling.
 *  - **`remembered-verification`** — a row recording that the verification gate AGREED an identity. The
 *    writer's `AgreementRow.modelId` (`recipe-workers`' `verification/verdictStore.ts`) is REQUIRED precisely
 *    so such a row cannot exist without that agreement, and
 *    the retrieval clears the tier's own `MEMO_SIMILARITY_FLOOR`. Consulting it before a fresh catalog
 *    search is asking a question that has already been answered before paying to answer it again.
 *  - **`catalog-ranking`** — a search result. KTD-A's own words: ZERO initial authority. It is the gate's
 *    INPUT, not an output of it, so a tier reading it is the last one asked.
 *
 * ⚠️ Ordering by evidence class happens to agree with ordering by COST here (local indexed reads before
 * cross-service searches), and that agreement is a convenience, not the justification. If the two ever
 * disagreed, precedence would win: consulting a weaker source first is not an optimisation, it is a
 * different answer.
 */
export const RESOLUTION_EVIDENCE_CLASSES = ['curated-mapping', 'remembered-verification', 'catalog-ranking'] as const;

/** Where a tier's evidence comes from — the cascade's ordering key. */
export type ResolutionEvidenceClass = (typeof RESOLUTION_EVIDENCE_CLASSES)[number];

/**
 * Which evidence class each chain tier retrieves from.
 *
 * ⛔ Exhaustive over {@link CascadeTierId} by type — a new tier cannot reach production without a declared
 * place in the order, which is the only thing that keeps the registry's array checkable.
 */
export const RESOLUTION_TIER_EVIDENCE: Readonly<Record<CascadeTierId, ResolutionEvidenceClass>> = {
    curated: 'curated-mapping',
    memo: 'remembered-verification',
    lexical: 'catalog-ranking',
};

/**
 * How early an evidence class is consulted — lower is earlier.
 *
 * Derived from {@link RESOLUTION_EVIDENCE_CLASSES}' own order rather than from a second hand-written table,
 * so inserting a class is one edit in one place and cannot leave two representations disagreeing.
 *
 * @param evidence - The class of source.
 * @returns Its rank, 0 being consulted first. Pure.
 */
export function precedenceRankOf(evidence: ResolutionEvidenceClass): number {
    return RESOLUTION_EVIDENCE_CLASSES.indexOf(evidence);
}

/**
 * The evidence class a tier id retrieves from, or `undefined` when the id names something that is not a
 * link of this chain.
 *
 * ⚠️ `undefined` is a VERDICT, not a lookup failure: `llm` names the verification gate, whose precedence
 * relative to these tiers is undefined because it does not compete with them. A caller registering such an
 * id as a tier is the defect that reads — see `resolutionRegistry.test.ts`.
 *
 * @param id - Any tier id, including one that is not a chain tier.
 * @returns The evidence class, or `undefined`. Pure.
 */
export function evidenceClassOf(id: ResolutionTierId): ResolutionEvidenceClass | undefined {
    // Widened rather than cast: `RESOLUTION_TIER_EVIDENCE` keeps its exhaustive type, and the lookup still
    // answers honestly for an id that is deliberately absent from it.
    const table: Readonly<Partial<Record<ResolutionTierId, ResolutionEvidenceClass>>> = RESOLUTION_TIER_EVIDENCE;

    return table[id];
}

/** A later-precedence tier standing in front of an earlier one — the shape that kills a tier's reach. */
export interface PrecedenceInversion {
    /** The later-precedence tier that sits EARLIER in the order, and therefore answers first. */
    readonly shadowing: ResolutionTierId;
    /** The earlier-precedence tier it stands in front of. */
    readonly shadowed: ResolutionTierId;
}

/**
 * Find every place a consultation order puts a later-precedence source ahead of an earlier one.
 *
 * ⚠️ ALL pairs, not adjacent ones. Adjacent comparison is sufficient to DETECT an unsorted sequence, but it
 * reports the wrong pair: in `[lexical, memo, curated]` the harm worth naming is a machine guess standing in
 * front of a human ruling, which is not an adjacent pair. Equal precedence is not an inversion — order
 * between peers is a cost decision. An id with no chain evidence class is skipped rather than given an
 * invented rank; registering one is a separate, separately-asserted defect.
 *
 * @param order - The consultation order, as tier ids.
 * @returns Every (earlier-in-order, earlier-in-precedence) pair, in consultation order. Empty means
 *   correctly ordered. Pure.
 */
export function findPrecedenceInversions(order: readonly ResolutionTierId[]): readonly PrecedenceInversion[] {
    const inversions: PrecedenceInversion[] = [];

    for (const [position, shadowing] of order.entries()) {
        const shadowingEvidence = evidenceClassOf(shadowing);

        if (shadowingEvidence === undefined) {
            continue;
        }

        for (const shadowed of order.slice(position + 1)) {
            const shadowedEvidence = evidenceClassOf(shadowed);

            if (shadowedEvidence === undefined) {
                continue;
            }

            if (precedenceRankOf(shadowingEvidence) > precedenceRankOf(shadowedEvidence)) {
                inversions.push({ shadowing, shadowed });
            }
        }
    }

    return inversions;
}

/**
 * What one tier reports.
 *
 * TWO MEMBERS, and that is the whole of Chain of Responsibility's contract: handle, or pass on.
 *
 * ⚠️ The `resolved` member is where a measured `confidence` belongs if one is ever derived — additive, and
 * no tier that ignores it needs to change. ⛔ A third `deferred` member is NOT coming: see the file
 * docstring for why the verification gate is not a tier of this chain at all.
 */
export type TierOutcome =
    | {
          readonly kind: 'resolved';
          readonly tier: ResolutionTierId;
          /** The opaque food-service id this phrase resolves to. */
          readonly foodId: string;
          /** Why this tier answered — carried into telemetry and into a reviewer's read of a resolution. */
          readonly evidence: string;
          /**
           * The measured margin (`top - runnerUp` on the tier's own scale) — the reserved additive field
           * the file docstring promised (plan U4). `undefined` for a singleton shortlist (a missing
           * runner-up is NOT a margin of zero — see `marginBandOf`) and for tiers that rank nothing.
           */
          readonly confidence?: number | undefined;
          /** The full structured shortlist (KTD-C), for the gate's evidence and the event log. */
          readonly shortlist?: readonly ScoredCandidate[] | undefined;
          /** The top hit's ladder rung — the band key's first axis. Ranking tiers only. */
          readonly rung?: string | undefined;
          /**
           * U11 (R20): the shortlist contained the CALLER's own private authored food, so its margins are
           * facts about one user's catalog rather than the shared ranker. The event records the flag, no
           * band epoch is observed, and the verification is excluded from band feedback on both sides.
           */
          readonly authorAugmented?: boolean | undefined;
      }
    | {
          readonly kind: 'pass';
          readonly tier: ResolutionTierId;
          /** Why this tier declined: a miss, or a hit it did not trust enough to answer with. */
          readonly reason: string;
      };

/** The phrase being resolved, parsed once at the boundary and passed down. */
export interface ResolutionQuery {
    /** The match grain every tier keys on. */
    readonly key: NormalizedIngredientKey;
    /** The raw phrase, for tiers that retrieve on text rather than on the key. */
    readonly phrase: string;
}

/** Per-request facts a tier may need, distinct from the collaborators a tier is constructed with. */
export interface ResolutionContext {
    /**
     * The requesting user, or `undefined` for an unattended import (R22).
     *
     * ⛔ `undefined` is not "some user we did not bother to look up" — it means NOBODY is present, and tiers
     * treat it as such: the curated tier shows an unattended caller global mappings and nobody's personal
     * ones, because one user's private correction must never silently rewrite an import.
     */
    readonly userId: string | undefined;
    /**
     * The caller's own bearer, for tiers that query another service AS the caller (the lexical tier —
     * issue #120's rule). `undefined` when nobody is present; the lexical tier then degrades exactly like
     * a down catalog rather than substituting a credential.
     *
     * ⛔ REQUIRED, not optional-with-default: every construction site must decide who is calling, the same
     * discipline `VerifiableLine.resolutionTier` applies (plan U2).
     */
    readonly caller: CallerToken | undefined;
}

/**
 * One tier of the cascade.
 *
 * DESIGN PATTERN: **Strategy**, and also the **Port** through which U5/U6 and U11 attach their tiers without
 * this module knowing anything about ranking or inference. A tier is constructed with its own collaborators
 * (a DAL, a gateway) and receives only per-request facts here.
 *
 * ⚠️ `resolve` is IMPURE by nature — every tier reads something. The judgement each tier makes is kept in a
 * separate pure `decide*` function beside it (the pure-`decide` / impure-`evaluate` split this repository
 * already uses in `deploy-gate.sh` and in `evaluateProvenance` vs `RecipesService.create`), so the rule is
 * unit-testable as a truth table and the adapter has nothing left in it to get wrong but the query.
 */
export interface ResolutionTier {
    readonly id: ResolutionTierId;
    /**
     * Attempt to resolve the query.
     *
     * @param query - The phrase and its key.
     * @param context - Per-request facts (the requesting user, or its absence).
     * @returns This tier's verdict.
     * @sideEffect Performs this tier's own I/O.
     */
    resolve(query: ResolutionQuery, context: ResolutionContext): Promise<TierOutcome>;
}

/** What the cascade as a whole concluded. */
export type CascadeOutcome =
    | {
          readonly kind: 'resolved';
          readonly tier: ResolutionTierId;
          readonly foodId: string;
          readonly evidence: string;
          /** Passed through from the winning tier's outcome — see {@link TierOutcome}'s resolved member. */
          readonly confidence?: number | undefined;
          readonly shortlist?: readonly ScoredCandidate[] | undefined;
          readonly rung?: string | undefined;
          readonly authorAugmented?: boolean | undefined;
          /** The tiers consulted, in order, up to and including the one that answered. */
          readonly consulted: readonly ResolutionTierId[];
          /** The consulted tiers whose I/O FAILED. Never overlaps with the tier that answered. */
          readonly unavailable: readonly ResolutionTierId[];
      }
    | {
          readonly kind: 'exhausted';
          readonly consulted: readonly ResolutionTierId[];
          /**
           * The consulted tiers whose I/O FAILED.
           *
           * ⛔ NON-EMPTY MEANS "WE COULD NOT LOOK", not "we looked and found nothing". A caller writing a
           * terminal status on an exhausted cascade must check this first, or a database blip becomes a
           * permanent fact about an ingredient.
           */
          readonly unavailable: readonly ResolutionTierId[];
      };

/** How the cascade reports a tier whose I/O failed. */
export interface CascadeObservers {
    /**
     * Called once per tier failure.
     *
     * Required rather than optional and defaulted, so a caller cannot acquire a silently-degrading cascade by
     * omission. Its own failure is swallowed: observability must not become an availability dependency.
     */
    readonly onTierFailure: (tier: ResolutionTierId, error: unknown) => void;
}

/**
 * Run the tiers in order and return the first resolution, or exhaustion.
 *
 * The loop is deliberately sequential rather than concurrent, and that is the requirement rather than a
 * simplification: R11 makes the tiers a PRECEDENCE, so consulting a later one before an earlier one has
 * declined would let a machine guess outrank a curated mapping — and R12's "falls through only on a miss"
 * means a later tier must not even be CALLED, which is the entire content of AE6's and AE8's "without an LLM
 * call". It is also the cheaper order: the tiers are ordered by cost, so the common case stops at the
 * cheapest one that knows the answer.
 *
 * @param tiers - The ordered registry. An empty chain is exhaustion, not an error.
 * @param query - The phrase and its key.
 * @param context - Per-request facts (the requesting user, or its absence).
 * @param observers - Where a tier failure is reported.
 * @returns The first resolution, or exhaustion with what was consulted and what was unavailable.
 * @sideEffect Delegates to tiers, which perform I/O.
 */
export async function runResolutionCascade(
    tiers: readonly ResolutionTier[],
    query: ResolutionQuery,
    context: ResolutionContext,
    observers: CascadeObservers,
): Promise<CascadeOutcome> {
    const consulted: ResolutionTierId[] = [];
    const unavailable: ResolutionTierId[] = [];

    for (const tier of tiers) {
        consulted.push(tier.id);

        let outcome: TierOutcome;

        try {
            outcome = await tier.resolve(query, context);
        } catch (error) {
            unavailable.push(tier.id);
            report(observers, tier.id, error);
            continue;
        }

        if (outcome.kind === 'resolved') {
            return {
                kind: 'resolved',
                tier: outcome.tier,
                foodId: outcome.foodId,
                evidence: outcome.evidence,
                confidence: outcome.confidence,
                shortlist: outcome.shortlist,
                rung: outcome.rung,
                authorAugmented: outcome.authorAugmented,
                consulted,
                unavailable,
            };
        }
    }

    return { kind: 'exhausted', consulted, unavailable };
}

/**
 * Report a tier failure without letting the report itself fail the cascade.
 *
 * @param observers - The observer bundle.
 * @param tier - The tier that failed.
 * @param error - What it threw.
 * @sideEffect Calls the caller-supplied sink.
 */
function report(observers: CascadeObservers, tier: ResolutionTierId, error: unknown): void {
    try {
        observers.onTierFailure(tier, error);
    } catch {
        // Deliberately empty. A broken logger degrades the signal; it must never degrade the resolution, and
        // there is nowhere left to report a reporting failure to.
    }
}
