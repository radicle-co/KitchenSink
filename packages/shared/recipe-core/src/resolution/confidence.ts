/**
 * THE VERIFICATION VERDICT and the confidence band it yields (plan U11 / R16, R17, R21).
 *
 * DESIGN PATTERN: **Value object + total mapping.** The verdict is a closed set of named rungs, and every
 * function here is a total map over that set — no numbers to invent a scale for, no `default:` branch to fall
 * through.
 *
 * ## ⛔ WHY IT LIVES IN `recipe-core`, and why the band is not computed at the read site
 *
 * Two processes hold this knowledge. `recipe-workers` produces a verdict and stores it; recipe-service reads
 * the stored verdict and decides whether the line's nutrition publishes. If each derived "does this publish?"
 * for itself, the two would drift — and the drift would be silent, because both answers are plausible. One
 * mapping, imported by both. `recipe-workers` cannot import recipe-service's `src`, so a shared package is the
 * only place it can live.
 *
 * ⛔ Reachable ONLY as `@kitchensink/recipe-core/resolution/confidence`, never from the barrel: `contract-gen`
 * hashes `src/index.ts`, so adding a line there moves the recipe service's `CONTRACT_HASH`.
 *
 * ## ⛔ CERTAINTY IS AN ORDINAL, AND ABSTENTION IS A MEMBER
 *
 * R16: "an ordinal ranking score is not a confidence value until the document says how it becomes one", and
 * R17 makes the bands MEASURED rather than chosen. So the model is asked for a named rung it cannot
 * misinterpret, never a probability — and a model that cannot judge a line says `abstain` rather than
 * pretending to a verdict at a low number. "Agree, certainty 0.1" is exactly that pretence, and it is the
 * shape that quietly publishes.
 *
 * ## ⚠️ THE ASYMMETRY THIS ENCODES, stated once
 *
 * A wrong AGREE passes data that would have shipped anyway — no worse than today. A wrong DISAGREE withholds
 * nutrition from a correct line, which IS worse than today, and the plan names its rate as the number that
 * triggers a rethink. So the mapping is deliberately reluctant to contradict: a low-certainty disagreement
 * lands on `inconclusive`, and `inconclusive` publishes. Only an explicit, non-hedged contradiction withholds.
 */
import { z } from 'zod';

/**
 * What the model may return, in the order the prompt lists them.
 *
 * `abstain` is a first-class member, not a low certainty: the schema branch is how a model declines a line it
 * cannot judge without asserting something it does not hold.
 */
export const VERIFICATION_VERDICTS = ['agree', 'disagree', 'abstain'] as const;

/** The model's judgement of a line. */
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

/**
 * The certainty rungs, LEAST certain first.
 *
 * The array's order IS the ordinal — declared once here rather than implied by a comparison at each call site,
 * which is how two call sites end up disagreeing about whether `medium` outranks `high`.
 */
export const CERTAINTY_ORDER = ['low', 'medium', 'high'] as const;

/** How sure the model says it is. */
export type VerificationCertainty = (typeof CERTAINTY_ORDER)[number];

/**
 * The three bands a verdict collapses into.
 *
 *  - `verified` — the model agreed and did not hedge. The only band that records agreement.
 *  - `contradicted` — the model disagreed and did not hedge. The only band that withholds.
 *  - `inconclusive` — an abstention, or either verdict at the lowest rung. Behaves as though the gate had not
 *    run, which is what it means.
 */
export type ConfidenceBand = 'verified' | 'contradicted' | 'inconclusive';

/**
 * Per-aspect verdicts (owner ruling 2026-08-31, U15 report "Owner rulings" §4).
 *
 * The joint verdict conflates identity with quantity — a correct food with an unparseable amount lands
 * `disagree` — so the model also says which aspect it disputes. ⛔ The OVERALL verdict stays authoritative
 * for banding (`bandFor` reads nothing here); this refines it, and its one consumer rule is U13's: a line
 * surfaces for human re-pick only when the overall verdict is `disagree` AND `identity` here is
 * `disagree`, so a self-contradictory answer (overall agree, identity disagree) surfaces nothing.
 */
export interface AspectVerdicts {
    readonly identity?: VerificationVerdict | undefined;
    readonly quantity?: VerificationVerdict | undefined;
}

/** A verdict as the model gave it. */
export interface VerificationOutcome {
    readonly verdict: VerificationVerdict;
    readonly certainty: VerificationCertainty;
    /** Which aspect the verdict is about, when the model itemized (absent from an older prompt's answer). */
    readonly aspects?: AspectVerdicts | undefined;
    /** Model-authored diagnostic text. Never shown to a user, never the verdict. */
    readonly reason?: string | undefined;
}

/**
 * The longest model-authored reason we will store.
 *
 * Bounded because it is text a model wrote, persisted in our database and read by an operator. Unbounded model
 * output in a `text` column is an availability question (a model that loops) before it is a storage one, and
 * `maxTokens` bounds the RESPONSE, not any single field within it.
 */
export const MAX_VERDICT_REASON_LENGTH = 500;

/**
 * The verdict shape the model is asked for.
 *
 * `z.object`, so a key the model invented is STRIPPED rather than rejected: a model that helpfully adds
 * `confidence_score` has still answered the question, and refusing the answer converts a cosmetic difference
 * into a spent call that proved nothing. Everything the verdict actually TURNS ON is required and enum-bounded,
 * so no near-miss can parse into an `agree`.
 */
export const verificationOutcomeSchema = z.object({
    verdict: z.enum(VERIFICATION_VERDICTS),
    certainty: z.enum(CERTAINTY_ORDER),
    /**
     * ⛔ `strictObject`, unlike the envelope: an unknown ASPECT key is refused, not stripped. The envelope
     * strips invented keys because a model that adds `confidence_score` has still answered; an aspects
     * object naming an aspect nothing asked about is an answer to a DIFFERENT question, and U13 acts on
     * what this object says.
     */
    aspects: z
        .strictObject({
            identity: z.enum(VERIFICATION_VERDICTS).optional(),
            quantity: z.enum(VERIFICATION_VERDICTS).optional(),
        })
        .optional(),
    reason: z.string().max(MAX_VERDICT_REASON_LENGTH).optional(),
});

/**
 * Whether `left` sits above `right` on the certainty ordinal.
 *
 * @param left - A rung.
 * @param right - Another rung.
 * @returns Whether `left` is strictly more certain. Pure.
 */
export function isMoreCertainThan(left: VerificationCertainty, right: VerificationCertainty): boolean {
    return CERTAINTY_ORDER.indexOf(left) > CERTAINTY_ORDER.indexOf(right);
}

/**
 * Collapse a verdict into its band.
 *
 * Total over the union with no `default:` — a new verdict member is a compile error here rather than a silent
 * fall-through, and a silent fall-through in this function publishes nutrition nothing checked.
 *
 * @param outcome - The verdict and its certainty.
 * @returns The band. Pure.
 */
export function bandFor(outcome: VerificationOutcome): ConfidenceBand {
    if (outcome.certainty === 'low') {
        // ⛔ The hedge is honoured, not promoted. A model that says "disagree, but I am not sure" has told us
        // it cannot support a withholding, and withholding anyway manufactures the wrong-DISAGREE outcome
        // this unit ranks as the unacceptable one.
        return 'inconclusive';
    }

    switch (outcome.verdict) {
        case 'agree':
            return 'verified';
        case 'disagree':
            return 'contradicted';
        case 'abstain':
            return 'inconclusive';
    }
}

/**
 * Whether a band lets the line's nutrition publish.
 *
 * ⚠️ `inconclusive` PUBLISHES, and that is a decision rather than an oversight. The gate runs off a queue, so
 * a line publishes between save and verification whatever this returns; the only coherent read-side rule is
 * "an explicit contradiction withholds, everything else behaves as it did before the gate existed". It also
 * makes a LOST verdict benign, which matters because the worker must be free to fail its verdict write
 * without re-spending the call.
 *
 * @param band - The band.
 * @returns Whether nutrition publishes. Pure.
 */
export function publishesFrom(band: ConfidenceBand): boolean {
    return band !== 'contradicted';
}
