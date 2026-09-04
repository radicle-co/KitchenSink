/**
 * THE RESIDENCY REFUSAL AS AN ERROR — the out-of-band channel from the gated spine to the handler that
 * classifies it (ADR-0024 §4b).
 *
 * DESIGN PATTERN: the repository's **typed-error convention** (`extend Error`, `Object.setPrototypeOf`, a
 * matching `is*` guard), used as a Ports-and-Adapters escape hatch: `gatedConverse` is four call sites deep
 * behind `ParseEnginePort`, `RetryParsePort`, `FoodnessValidatorPort` and `MeasurementValidatorPort`, none of
 * whose return types can express "no call was made" — and widening all four to say so would push a spend
 * concern into every parse contract.
 *
 * ## ⛔ WHY AN ERROR RATHER THAN ABSENCE, WHICH IS THE OBVIOUS CHOICE AND IS WRONG
 *
 * Returning absence from the parse ports — `{ unavailable: true }`, `could-not-judge` — reads correct: the
 * LLM did not answer, and `single-engine` is a modelled outcome. Trace it and it is the defect
 * `parseLine.ts` was repaired for. `processParseLine`'s rule is that **an engine that returns absence states
 * a deterministic per-line fact, while an engine that THROWS is an outage**, and its own comment records
 * what happens when the two are confused: the CRF was missing from the transient set, so "a line parsed
 * during a CRF outage landed the LLM's single-engine reading as its PERMANENT answer", which ADR-0026's
 * 2026-08-31 rule forbids — an outage becoming a fact about an ingredient. A residency refusal is a
 * deployment fault, not a fact about the line, so it belongs on the same side of that split as the outage.
 *
 * ⚠️ This does NOT contradict ADR-0026 §3's "absence is not dissent". §3 governs the COMPARATOR — a silent
 * engine is never recorded as disagreeing — and nothing here records a verdict, a `differ` or a `ParsedLine`
 * with empty fields. §3's own next clause is the reason for this file: collapsing the two "turns a transient
 * outage into a permanent fact about an ingredient."
 *
 * ## ⛔ AND WHY IT IS NOT SIMPLY RE-THROWN, EITHER
 *
 * `processParseLine` re-throws everything it collects as transient, which redelivers under SQS
 * `maxReceiveCount` and drains to the DLQ. A residency refusal is deterministic in (model, region) and can
 * never succeed on retry — no number of redeliveries makes feature 016 record a warrant — so it is caught by
 * name and lands NOTHING: no permanent answer for the line, and no queue churn reporting a standing product
 * decision as DLQ depth. That is a fourth class beside TRANSIENT, TERMINAL and DISCARDED, and it exists
 * because the refusal genuinely is a fourth thing.
 */
import type { ResidencyUnapproved } from '@kitchensink/recipe-core/spend/spend-arithmetic';

/**
 * A Bedrock call that was never made, because the model's inference profile leaves the deploy region and
 * nobody has cleared it.
 */
export class ResidencyRefusedError extends Error {
    /** The whole refusal, so a handler can log which model, from where, and the reach it would have had. */
    public readonly refusal: ResidencyUnapproved;

    /**
     * @param refusal - The plan `planReservation` returned instead of a priced one.
     */
    public constructor(refusal: ResidencyUnapproved) {
        super(
            `model '${refusal.modelId}' is not cleared for residency from ${refusal.deployRegion} ` +
                `(reaches ${refusal.reachedRegions.join(', ')}); the call was not made`,
        );
        this.name = 'ResidencyRefusedError';
        this.refusal = refusal;
        Object.setPrototypeOf(this, ResidencyRefusedError.prototype);
    }
}

/**
 * Whether an unknown value is a {@link ResidencyRefusedError}.
 *
 * ⚠️ A property check rather than `instanceof` alone: the error crosses a bundle boundary (the pipeline
 * catches it in `recipe-import-core` and the handler re-reads it here), and `instanceof` is unreliable when
 * two copies of a class can exist. The same reason every `is*` guard in this repository is written this way.
 *
 * @param error - Any caught value.
 * @returns Whether it is a residency refusal. Pure.
 */
export function isResidencyRefusedError(error: unknown): error is ResidencyRefusedError {
    return error instanceof ResidencyRefusedError || (error instanceof Error && error.name === 'ResidencyRefusedError');
}
