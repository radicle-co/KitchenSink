/**
 * The error taxonomy of the Bedrock boundary — and, in `settlement`, the REFUND RULE of ADR-0024's counter.
 *
 * DESIGN PATTERN: **error taxonomy** (§1's "one file, one thing" ruling — the unit is "the errors this
 * boundary can raise"; the set IS the type). Every member extends `Error`, calls `Object.setPrototypeOf`, and
 * ships a matching `is*` guard, per the repo custom-error convention.
 *
 * ## ⛔ `settlement` IS THE LOAD-BEARING FIELD, and its DEFAULT points at over-counting
 *
 * ADR-0024 §2: "Any outcome with no billed response refunds in full … without this a throttling episode
 * consumes the ceiling at ZERO actual spend and then closes the gate for the rest of the month." So the
 * settle path needs to know, for every failure, what to do with the reservation. It reads `settlement` and
 * nothing else — there is no `instanceof` ladder to keep in step with this file.
 *
 * ⚠️ It names a DECISION, not a fact. An earlier draft called this `billed: boolean`, which asserts something
 * we frequently cannot know — a client-side abort may or may not have been served. Two values, and the base
 * class defaults to **`keep-reservation`**, so only the failures AWS documents as pre-inference refusals
 * refund. That direction is deliberate and it is the one every other bias in ADR-0024 points:
 *
 *  - Refunding a call that WAS billed **under-counts**, and "a counter that silently under-reports during a
 *    runaway is worse than no counter, because it reports green."
 *  - Not refunding a call that was NOT billed **over-counts**, which is the explicitly accepted consequence
 *    ("Crashes over-count … recorded because the arithmetic is deliberately biased one way").
 *
 * An exception nobody has enumerated yet therefore keeps its reservation. That is the correct answer to a
 * failure mode we do not understand.
 *
 * ⚠️ NONE of these messages carry the provider's own text. A raw upstream message can quote the request, and
 * the request contains a user's recipe line.
 */

/**
 * What the counter must do with the reservation this failure leaves outstanding.
 *
 * `refund-full` is ADR-0024's `$actual = 0` settlement; `keep-reservation` leaves the worst-case charge
 * standing, which over-counts and is the safe direction.
 */
export type SpendSettlement = 'refund-full' | 'keep-reservation';

/**
 * Base class for every failure of the Bedrock boundary.
 *
 * @property settlement - What the counter does with the outstanding reservation. Defaults to
 *   `keep-reservation` on purpose, so an unrecognised failure never triggers a refund on a guess.
 */
export class BedrockClientError extends Error {
    public readonly settlement: SpendSettlement;

    public constructor(message: string, settlement: SpendSettlement = 'keep-reservation') {
        super(message);
        this.name = 'BedrockClientError';
        this.settlement = settlement;
        Object.setPrototypeOf(this, BedrockClientError.prototype);
    }
}

/** Type guard for {@link BedrockClientError} — and therefore for reading `settlement`. */
export function isBedrockClientError(error: unknown): error is BedrockClientError {
    return error instanceof BedrockClientError;
}

/** `ThrottlingException` (429). The request was refused before inference; nothing was billed. */
export class BedrockThrottledError extends BedrockClientError {
    public constructor(message = 'bedrock: request throttled') {
        super(message, 'refund-full');
        this.name = 'BedrockThrottledError';
        Object.setPrototypeOf(this, BedrockThrottledError.prototype);
    }
}

/** Type guard for {@link BedrockThrottledError}. */
export function isBedrockThrottledError(error: unknown): error is BedrockThrottledError {
    return error instanceof BedrockThrottledError;
}

/**
 * `ServiceUnavailableException` / `InternalServerException` / `ModelNotReadyException`.
 *
 * The service could not run the model, so no tokens were generated and nothing was billed.
 */
export class BedrockUnavailableError extends BedrockClientError {
    public constructor(message = 'bedrock: the model is unavailable') {
        super(message, 'refund-full');
        this.name = 'BedrockUnavailableError';
        Object.setPrototypeOf(this, BedrockUnavailableError.prototype);
    }
}

/** Type guard for {@link BedrockUnavailableError}. */
export function isBedrockUnavailableError(error: unknown): error is BedrockUnavailableError {
    return error instanceof BedrockUnavailableError;
}

/**
 * `AccessDeniedException` (403) — the execution role does not hold `bedrock:InvokeModel` on this model.
 *
 * ⚠️ Worth its own member rather than folding into "unavailable": this is the signal that ADR-0024 layer 4b's
 * single-grantee IAM posture has drifted, or that the SSM model parameter names a model the role was never
 * granted. It is a deploy defect wearing a runtime error's clothes, and it must be legible as such.
 */
export class BedrockAccessDeniedError extends BedrockClientError {
    public constructor(message = 'bedrock: access denied for this model') {
        super(message, 'refund-full');
        this.name = 'BedrockAccessDeniedError';
        Object.setPrototypeOf(this, BedrockAccessDeniedError.prototype);
    }
}

/** Type guard for {@link BedrockAccessDeniedError}. */
export function isBedrockAccessDeniedError(error: unknown): error is BedrockAccessDeniedError {
    return error instanceof BedrockAccessDeniedError;
}

/** `ValidationException` (400) — the request was malformed, so it was rejected before inference. */
export class BedrockInvalidRequestError extends BedrockClientError {
    public constructor(message = 'bedrock: the request was rejected as invalid') {
        super(message, 'refund-full');
        this.name = 'BedrockInvalidRequestError';
        Object.setPrototypeOf(this, BedrockInvalidRequestError.prototype);
    }
}

/** Type guard for {@link BedrockInvalidRequestError}. */
export function isBedrockInvalidRequestError(error: unknown): error is BedrockInvalidRequestError {
    return error instanceof BedrockInvalidRequestError;
}

/**
 * `ModelTimeoutException`, or a client-side abort/timeout before any response was received.
 *
 * ⚠️⚠️ THIS IS THE ONE MEMBER WHOSE `refund-full` IS A JUDGEMENT, NOT A DOCUMENTED FACT — flagged for an
 * owner ruling rather than quietly decided here. `ThrottlingException`, `AccessDeniedException` and
 * `ValidationException` are provably PRE-inference: the request was refused, so no tokens were generated. A
 * client-side abort is not — AWS bills for inference PERFORMED, and the model may well have run. So
 * refunding a timeout in full is, strictly, the silent under-count reserve-then-settle exists to prevent, and
 * timeouts are correlated with the runaway the ceiling exists to stop.
 *
 * It is `refund-full` anyway because ADR-0024 §2 names client timeouts explicitly among the outcomes that
 * settle at `$actual = 0`, and drifting from an owner-ratified ADR inside an implementation is worse than
 * carrying a flagged residual. The alternative — never refunding a timeout — lets a transient network fault
 * consume the ceiling. Residual exposure if the ADR is right: nothing. If it is wrong: one worst-case
 * reservation per timeout goes uncounted, against ~370x headroom. **Changing this is a one-line edit to
 * `UNBILLED_FAILURES` once the ADR is amended.**
 */
export class BedrockTimeoutError extends BedrockClientError {
    public constructor(message = 'bedrock: the request timed out') {
        super(message, 'refund-full');
        this.name = 'BedrockTimeoutError';
        Object.setPrototypeOf(this, BedrockTimeoutError.prototype);
    }
}

/** Type guard for {@link BedrockTimeoutError}. */
export function isBedrockTimeoutError(error: unknown): error is BedrockTimeoutError {
    return error instanceof BedrockTimeoutError;
}
