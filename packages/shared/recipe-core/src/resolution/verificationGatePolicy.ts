/**
 * THE VERIFICATION GATE'S DECISION (plan U11 / KTD-3, R15–R18) — what, if anything, the model is asked.
 *
 * DESIGN PATTERN: **Specification / Policy module**, the sibling of `recipes/domain/provenancePolicy.ts` and
 * of `ingredients/domain/mappingScopePolicy.ts`, and the pure half of the decide/evaluate split
 * `deploy-gate.sh` already uses. It answers ONE question — "for this line, which aspects must be checked?" —
 * from its inputs alone: no database, no queue, no provider, no clock. Thresholds arrive as a parameter for
 * the same reason `evaluateVisibility` takes `isPremium: boolean` rather than a principal: a policy that can
 * reach a request cannot be exhausted as a truth table, and R17 says the bands are MEASURED, so calibration
 * must be a VALUE change rather than a code change.
 *
 * ## ⛔ WHY IT LIVES IN `recipe-core`
 *
 * It is run at BOTH ends and must be the same rule at both. recipe-service runs it to decide whether to
 * enqueue at all (ADR-0024 layer 0: the cheapest control in the stack is the message that is never sent), and
 * `recipe-workers` re-runs it on the parsed message to decide what it actually asks about — because a
 * producer bug or a replayed message must not be able to skip an identity check silently. The message
 * therefore carries INPUTS, never conclusions. `recipe-workers` cannot import recipe-service's `src`, so a
 * shared package is the only place one rule can live.
 *
 * ⛔ Reachable ONLY as `@kitchensink/recipe-core/resolution/verification-gate-policy`, never from the barrel:
 * `contract-gen` hashes `src/index.ts`, so one added line there moves the recipe service's `CONTRACT_HASH`
 * for a module with no wire projection.
 *
 * ## ⛔ THE SKIP SET IS PER-ASPECT, AND QUANTITY IS NEVER SKIPPABLE — this AMENDS KTD-3
 *
 * KTD-3 argues that an exact tier-1 hit "skips the food-identity check only … a curated mapping is keyed on a
 * normalized phrase and can establish nothing about quantity. The parser defects this plan exists to fix are
 * quantity defects and they land on tier-1 lines too."
 *
 * That argument is word-for-word true of the other two doors. A wide lexical margin and inter-candidate
 * nutrient agreement are both facts about WHICH CANDIDATE RANKED BEST — about identity — and neither has ever
 * looked at a number, a unit or a range. Letting either skip the WHOLE gate would publish an unchecked
 * quantity on every wide-margin line, and quantity defects are 100% of what U7 exists to fix. So identity
 * evidence excuses the identity aspect and nothing else.
 *
 * This costs nothing the plan was counting on: its own cost basis (~8,000 calls/month) is stated "under
 * KTD-3's verify-everything policy". The skip conditions were never buying call reduction; they buy prompt
 * narrowing.
 *
 * ## ⚠️ NUTRIENT EQUIVALENCE IS AN OBSERVATION, NOT A DOOR — also an amendment
 *
 * KTD-3 guards it with "applies only when the winning candidate also cleared the margin test". A cleared
 * margin is ALREADY an independent skip condition, so under that guard nutrient equivalence is strictly
 * subsumed and can never widen the skip set. The three available repairs were: invent a second, lower margin
 * threshold (forbidden by R17 — the bands are measured and the bake-off has not run); ship it as a redundant
 * conjunct (a named shape that is dead code, which is worse than absence because the name then lies); or
 * demote it to a measurement. It is demoted. {@link GateObservations.nutrientAgreement} is exactly the
 * evidence a later calibration needs to decide whether it deserves to be a door.
 *
 * And it is the right thing to distrust: R16's own evidence is that the 334 lines which collapsed onto three
 * attractors were sets that agreed with each other and were all wrong. Inter-candidate agreement is not
 * correctness.
 */

/** What the model is asked about. */
export const VERIFICATION_ASPECTS = ['identity', 'quantity'] as const;

/**
 * One aspect of a line.
 *
 *  - `identity` — is this phrase really this food?
 *  - `quantity` — does our parsed amount, unit and range match what the source line says?
 */
export type VerificationAspect = (typeof VERIFICATION_ASPECTS)[number];

/**
 * One scored candidate from the lexical tier.
 *
 * Nutrient fields are per 100 g and individually optional: a catalog row may carry energy and no macros, and
 * an ABSENT value must never read as agreement (see {@link GateObservations.nutrientAgreement}).
 *
 * ⚠️ `score` is the lexical tier's OWN ordinal, on its own scale. This module never interprets it as a
 * probability — R16: "an ordinal ranking score is not a confidence value until the document says how it
 * becomes one". All it does is subtract two of them.
 */
export interface ScoredCandidate {
    /** The opaque food-service id. */
    readonly foodId: string;
    /** The tier's own ranking score. Higher is better; the scale is the tier's. */
    readonly score: number;
    readonly energyKcalPer100g?: number | undefined;
    readonly proteinGPer100g?: number | undefined;
    readonly fatGPer100g?: number | undefined;
    readonly carbohydrateGPer100g?: number | undefined;
}

/**
 * What the cascade knows about this line's IDENTITY, as a closed set.
 *
 * A discriminated union rather than `{ tier, shortlist }`, because a shortlist only means anything for a
 * ranked resolution — the pairing "tier: curated, shortlist: [...]" is a state that should not be
 * representable, and the margin guard reading a shortlist that a curated hit happened to carry is precisely
 * the sort of accident that skips an identity check nobody meant to skip.
 */
export type IdentityEvidence =
    | {
          /** A HUMAN asserted that this normalized phrase means this food (R19/R20, cascade tier 1). */
          readonly kind: 'curated-exact';
      }
    | {
          /** A machine's earlier answer, remembered (cascade tier 3). Establishes nothing on its own. */
          readonly kind: 'remembered';
      }
    | {
          /** The lexical tier's ranked shortlist (cascade tier 2). May be empty until U5 ships. */
          readonly kind: 'ranked';
          readonly shortlist: readonly ScoredCandidate[];
      }
    | {
          /**
           * ⛔ NO PROVENANCE WAS RECORDED — the honest state of the shipped producer, not a placeholder.
           *
           * `RecipesService` enqueues from PERSISTED `recipe_ingredients` rows. The cascade outcome that
           * first resolved the catalog row was discarded inside
           * `IngredientsService.resolveThroughCascade` (it keeps only `foodId`), and no column anywhere
           * records which tier answered — so by the time a line is saved against a recipe, WHICH tier
           * established identity is simply not recoverable.
           *
           * ⚠️ IT EXISTS BECAUSE THE WIRE ENUM IS A ONE-WAY DOOR, not because the two decide differently.
           * `rankedEvidence([])` decides identically TODAY and — checked, not assumed — produces a
           * byte-identical {@link GateObservations} (`shortlistOf` yields `[]` for both, so the size, the
           * margin and the agreement all match). What differs is the CLAIM: `ranked` asserts that the
           * lexical tier ran and offered nothing, on a value that is persisted in a queue message and
           * re-read by a separately-deployed consumer. The moment any skip door keys on `kind === 'ranked'`
           * — U5 ships exactly that tier — a producer that never ranked anything would be acting on a
           * statement it invented. This is the same argument that makes {@link IdentityEvidence} a union
           * rather than `{ tier, shortlist }`: a state that should not be representable should not be
           * spellable.
           *
           * It can never establish identity, so a line carrying it always verifies both aspects. That is
           * KTD-3's own default ("everything else verifies") and the safe direction: over-verifying costs
           * money at ~370x headroom, under-verifying publishes nutrition nothing checked.
           */
          readonly kind: 'unattributed';
      };

/** A human-asserted curated mapping. */
export const curatedExactEvidence = (): IdentityEvidence => ({ kind: 'curated-exact' });

/** A remembered machine resolution. */
export const rememberedEvidence = (): IdentityEvidence => ({ kind: 'remembered' });

/**
 * A resolution whose establishing tier was not recorded. See the `unattributed` member for why this is a
 * member of its own rather than an empty {@link rankedEvidence}.
 */
export const unattributedEvidence = (): IdentityEvidence => ({ kind: 'unattributed' });

/**
 * A ranked shortlist.
 *
 * @param shortlist - The scored candidates, in any order.
 * @returns The evidence value. Pure.
 */
export const rankedEvidence = (shortlist: readonly ScoredCandidate[]): IdentityEvidence => ({
    kind: 'ranked',
    shortlist,
});

/** The measured (or, until the bake-off runs, provisional) bounds the policy compares against. */
export interface VerificationThresholds {
    /**
     * `topScore - runnerUpScore` at or above which identity is taken as established.
     *
     * ⚠️ A MARGIN, not a score. KTD-3: "Abstain on margin, not score. A lone high-scoring candidate measured
     * 50% accurate against 71% when several were offered."
     */
    readonly wideMarginScore: number;
    /** Relative tolerance for inter-candidate nutrient agreement (0.10 = within 10%). */
    readonly nutrientAgreementFraction: number;
    /**
     * ADR-0024 layer 1's hard input cap, in Unicode CODE POINTS.
     *
     * Code points, not UTF-16 units: an astral character is one thing a tokenizer sees and two `String.length`
     * units, so `.length` would reject a legitimate line at half the stated cap and would make the cap mean
     * different things for different alphabets.
     */
    readonly maxSourceLineChars: number;
    /**
     * Whether these numbers came from the bake-off's residual slice, or are placeholders.
     *
     * ⛔ Carried as data rather than as a comment so a calibration can be ASSERTED. R17 makes the bands
     * measured; shipping placeholders under a name that does not say so is how an uncalibrated number becomes
     * a fact nobody re-examines.
     */
    readonly calibrated: boolean;
}

/**
 * Provisional thresholds — ⛔ NOT CALIBRATED.
 *
 * The bake-off (Nova Micro vs Claude Haiku 4.5 on the residual slice) is what sets these, and it has not run.
 * `wideMarginScore` is deliberately generous-to-verifying rather than generous-to-skipping: over-verifying
 * costs money at ~370x headroom, under-verifying publishes nutrition nothing checked.
 *
 * `maxSourceLineChars` is derived, not guessed: ADR-0024 sizes the prompt at ~660 input tokens, of which the
 * instructions and the parse are the bulk. 400 code points is ~100–130 tokens of ingredient line — several
 * times the longest line in the 2,432-line corpus — and it keeps the worst case a real bound.
 */
export const PROVISIONAL_VERIFICATION_THRESHOLDS: VerificationThresholds = Object.freeze({
    wideMarginScore: 0.2,
    nutrientAgreementFraction: 0.1,
    maxSourceLineChars: 400,
    calibrated: false,
});

/** The complete input to a gate decision. */
export interface VerificationGateInput {
    /**
     * The line the cook's source actually said, or `undefined` when there is none.
     *
     * ⛔ `undefined` is not "we did not look it up" — it means the line was AUTHORED, not transcribed, so
     * there is no source for our parse to disagree with. That is a skip, not a failure and not a disagreement.
     */
    readonly sourceLine: string | undefined;
    /** What the cascade established about identity. */
    readonly evidence: IdentityEvidence;
    /** The bands, injected. */
    readonly thresholds: VerificationThresholds;
}

/** Whether the shortlist's candidates agree on energy and the macronutrients per 100 g. */
export type NutrientAgreement = 'agree' | 'disagree' | 'unknown';

/**
 * What the policy MEASURED, reported whichever way it decided.
 *
 * This is calibration evidence, not a decision: R17 requires the bands to be measured, and they cannot be
 * measured from outcomes nobody recorded.
 */
export interface GateObservations {
    /** How many candidates were on offer. Zero for non-ranked evidence. */
    readonly shortlistSize: number;
    /**
     * `top - runnerUp`, or `undefined` when there was no runner-up.
     *
     * ⛔ `undefined`, never `0`. Zero is a real margin — two candidates that tied. Collapsing the two is how a
     * singleton shortlist starts reading as a tie rather than as the warning sign KTD-3 says it is.
     */
    readonly margin: number | undefined;
    /** Inter-candidate nutrient agreement. Reported — and since plan U1 (D4a), also the SECOND CONJUNCT
     * of the ranked identity skip: a wide margin opens nothing without it. */
    readonly nutrientAgreement: NutrientAgreement;
}

/**
 * What the gate decided.
 *
 * ⛔ `aspects` is a NON-EMPTY tuple by type, so "verify nothing" does not compile. A degenerate verify is the
 * worst outcome available: a call spent, a verdict recorded, and nothing actually checked.
 */
export type VerificationDecision =
    | { readonly kind: 'skip'; readonly reason: 'no-source-text'; readonly observations: GateObservations }
    | {
          readonly kind: 'verify';
          readonly aspects: readonly [VerificationAspect, ...VerificationAspect[]];
          readonly observations: GateObservations;
      }
    | {
          /**
           * ⛔ TERMINAL, and NOT the same as a skip. An over-cap line is REJECTED, never truncated: a
           * truncated line asks the model to judge text the user did not write, and that verdict gates
           * whether nutrition publishes. The line resolves as unresolved and is surfaced for correction,
           * which is true (ADR-0024 §2).
           */
          readonly kind: 'reject';
          readonly reason: 'source-line-over-cap';
          readonly observedChars: number;
          readonly capChars: number;
          readonly observations: GateObservations;
      };

/** The shortlist behind a piece of evidence, or empty. */
function shortlistOf(evidence: IdentityEvidence): readonly ScoredCandidate[] {
    return evidence.kind === 'ranked' ? evidence.shortlist : [];
}

/**
 * The gap between the two best scores, or `undefined` when there is no runner-up.
 *
 * Sorted here rather than trusted from the caller: a tier is free to hand back an unsorted list, and a tier's
 * ordering bug must not be able to read as maximal confidence.
 *
 * @param shortlist - The candidates, in any order.
 * @returns The margin, or `undefined`. Pure.
 */
function marginOf(shortlist: readonly ScoredCandidate[]): number | undefined {
    if (shortlist.length < 2) {
        return undefined;
    }

    const [top, runnerUp] = [...shortlist].sort((left, right) => right.score - left.score);

    return top === undefined || runnerUp === undefined ? undefined : top.score - runnerUp.score;
}

/** The four per-100 g values nutrient equivalence is computed over (KTD-3: energy plus the macronutrients). */
function nutrientVector(candidate: ScoredCandidate): readonly (number | undefined)[] {
    return [
        candidate.energyKcalPer100g,
        candidate.proteinGPer100g,
        candidate.fatGPer100g,
        candidate.carbohydrateGPer100g,
    ];
}

/**
 * Whether two values agree within a relative tolerance.
 *
 * @param left - First value.
 * @param right - Second value.
 * @param fraction - Relative tolerance.
 * @returns Whether they agree. Pure.
 */
function within(left: number, right: number, fraction: number): boolean {
    const scale = Math.max(Math.abs(left), Math.abs(right));

    return scale === 0 ? true : Math.abs(left - right) / scale <= fraction;
}

/**
 * Whether the shortlist's candidates agree on energy and the macros.
 *
 * ⛔ Returns `unknown` — never `agree` — when a value is missing. An absent vector must not read as evidence
 * FOR a candidate; that is the one coercion that turns "we know nothing about this" into a confirmation.
 *
 * @param shortlist - The candidates.
 * @param fraction - Relative tolerance.
 * @returns The agreement verdict. Pure.
 */
function nutrientAgreementOf(shortlist: readonly ScoredCandidate[], fraction: number): NutrientAgreement {
    if (shortlist.length < 2) {
        return 'unknown';
    }

    const vectors = shortlist.map(nutrientVector);
    const [reference] = vectors;

    if (reference === undefined) {
        return 'unknown';
    }

    for (const vector of vectors.slice(1)) {
        for (const [index, referenceValue] of reference.entries()) {
            const value = vector[index];

            if (referenceValue === undefined || value === undefined) {
                return 'unknown';
            }

            if (!within(referenceValue, value, fraction)) {
                return 'disagree';
            }
        }
    }

    return 'agree';
}

/**
 * Whether identity is already established well enough not to ask.
 *
 * The two doors KTD-3 leaves open, and only these two:
 *
 *  - a HUMAN asserted this phrase means this food; or
 *  - two or more scored candidates were on offer and the winner cleared the margin.
 *
 * A singleton shortlist can never pass — it has no runner-up, so {@link marginOf} is `undefined`, and a naive
 * `top - next` on one candidate reading as maximal confidence is the exact inversion KTD-3 guards against.
 * And since plan U1 (D4a), a wide margin passes ONLY together with nutrient agreement — the skip is a
 * conjunction, so a confidently-wrong ladder assignment cannot open the door on margin alone.
 *
 * @param evidence - What the cascade established.
 * @param thresholds - The bands.
 * @returns Whether the identity aspect may be skipped. Pure.
 */
function identityEstablished(
    evidence: IdentityEvidence,
    thresholds: VerificationThresholds,
    nutrientAgreement: NutrientAgreement,
): boolean {
    if (evidence.kind === 'curated-exact') {
        return true;
    }

    const margin = marginOf(shortlistOf(evidence));

    // ⛔ CONJUNCTIVE, never OR (plan U1, D4a — amends KTD-3's skip set). A wide margin alone let a
    // wide-margin-WRONG winner bypass the gate: `Cinnamon buns, frosted` won the bare query `cinnamon` by a
    // full tier (measured 2026-08-29). Requiring agreement as the second conjunct bounds the damage of any
    // false catch to candidates within the nutrient tolerance of each other — and an `unknown` agreement
    // fails toward verify, because missing data cannot affirm anything.
    return margin !== undefined && margin >= thresholds.wideMarginScore && nutrientAgreement === 'agree';
}

/**
 * Whether a line is blank once invisible characters are discounted.
 *
 * @param line - The candidate text.
 * @returns Whether it carries no visible content. Pure.
 */
function isBlank(line: string): boolean {
    // Whitespace AND the invisible formatting characters `sanitizeFoodName` already treats as absent — a line
    // of zero-width joiners is not a source line, and sending it would spend a call to verify nothing.
    return line.replace(/[\s\p{Cf}]/gu, '') === '';
}

/**
 * Decide what, if anything, the verification gate asks the model about this line.
 *
 * Total: every input produces a decision, and none throws. The order of the three branches is the order of
 * ADR-0024's cost layers — the free judgements come first, and only a line that survives all of them can
 * become a reservation.
 *
 * @param input - The source line, the cascade's identity evidence, and the bands.
 * @returns The decision, with the observations it measured on the way. Pure.
 */
export function decideVerification(input: VerificationGateInput): VerificationDecision {
    const shortlist = shortlistOf(input.evidence);
    const observations: GateObservations = {
        shortlistSize: shortlist.length,
        margin: marginOf(shortlist),
        nutrientAgreement: nutrientAgreementOf(shortlist, input.thresholds.nutrientAgreementFraction),
    };

    if (input.sourceLine === undefined || isBlank(input.sourceLine)) {
        return { kind: 'skip', reason: 'no-source-text', observations };
    }

    // Code points, not UTF-16 units — see VerificationThresholds.maxSourceLineChars.
    const observedChars = [...input.sourceLine].length;

    if (observedChars > input.thresholds.maxSourceLineChars) {
        return {
            kind: 'reject',
            reason: 'source-line-over-cap',
            observedChars,
            capChars: input.thresholds.maxSourceLineChars,
            observations,
        };
    }

    // ⛔ Quantity is NEVER absent from this tuple. Nothing the cascade produces is evidence about a number.
    const aspects: [VerificationAspect, ...VerificationAspect[]] = identityEstablished(
        input.evidence,
        input.thresholds,
        observations.nutrientAgreement,
    )
        ? ['quantity']
        : ['identity', 'quantity'];

    return { kind: 'verify', aspects, observations };
}
