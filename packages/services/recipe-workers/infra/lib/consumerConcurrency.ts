/**
 * THE concurrency authority for this stack's SQS consumers (plan U8, R1/R2/R4). One module, one policy,
 * two numbers — the stack imports; nothing restates.
 *
 * ## Why the two numbers cannot live apart
 *
 * A Lambda's `reservedConcurrentExecutions` caps how many invocations may RUN. An SQS event source
 * mapping's `maximumConcurrency` caps how many the poller will START. They are set on different resources
 * and neither validates the other, so the two ways of getting them wrong are both silent:
 *
 *  - **Reservation raised alone.** The poller keeps its old ceiling, so throughput does not move. The
 *    change looks applied — the function's configuration says 5 — and nothing is faster.
 *  - **Mapping raised alone.** The poller starts more invocations than the reservation admits and the
 *    surplus is THROTTLED. On an SQS event source that is not free: ⛔ a throttled delivery still spends a
 *    receive, so a perfectly healthy message walks its `maxReceiveCount` down and dead-letters for no
 *    reason except our own configuration. That is R2, and it is the failure that makes scaling by hand
 *    dangerous rather than merely fiddly.
 *
 * ## Why it is a function of the stage, not a constant
 *
 * ADR-0024's $100 ceiling is PROD-ONLY by owner ruling. In sandbox and every `pr-{N}`, this stack's
 * `reservedConcurrentExecutions: 1` is the ONLY thing standing between a redrive loop and the invoice —
 * the ADR names raising it as "the one change that makes this ruling unsafe". So the policy is: prod
 * scales both numbers together; non-prod scales neither, and keeps the reservation the ADR depends on.
 *
 * ⚠️ `maximumConcurrency` is OPTIONAL rather than a number, and that is AWS's constraint showing through:
 * the minimum accepted value is 2, so "non-prod runs one at a time" cannot be written as a mapping of 1.
 * It is written as NO mapping concurrency at all, and `undefined` is the only honest representation.
 *
 * @module
 */

/** The stage classes this policy distinguishes. A closed union — see {@link CONSUMER_CONCURRENCY}. */
export type StageClass = 'prod' | 'non-prod';

/** The pair a consumer needs: what may run, and what the poller may start. */
export interface ConsumerConcurrency {
    /** `reservedConcurrentExecutions` on the function. */
    readonly reserved: number;
    /** `maximumConcurrency` on the SQS event source mapping, or absent to leave it unset. */
    readonly maximumConcurrency?: number;
}

/**
 * Prod's concurrency for both consumers.
 *
 * ⛔ FIVE, and the number is a floor chosen from what bounds it rather than a guess. It is bounded ABOVE by
 * Bedrock's verified `us-east-1` quotas for the wired models (Nova 2 Lite: 2,000 requests/minute
 * cross-region), which five concurrent ~1-second calls come nowhere near — so the quota is not what limits
 * this. It is bounded BELOW by 2, which is the smallest value AWS accepts for a mapping's
 * `maximumConcurrency`. Within that range the binding consideration is ADR-0024's ceiling, which holds at
 * ANY concurrency because the reservation is charged before the call and the row lock serialises callers —
 * so raising this cannot overspend, only reach the ceiling sooner.
 *
 * ⚠️ Raise it deliberately, not reflexively: the ceiling is a MONTHLY pool, so a higher concurrency
 * exhausts it earlier in the month and denials arrive as DLQ depth. Five is where this starts.
 */
export const PROD_CONSUMER_CONCURRENCY = 5;

/**
 * The policy, as an exhaustive map over the union.
 *
 * ⛔ A `Record<StageClass, …>` rather than a lookup with a fallback, for the reason the ALB priority
 * allocator uses the same shape: a new stage class added without a policy is then a BUILD failure, where a
 * fallback would let it silently inherit whichever branch happened to be the default — and here the
 * default that costs money is the one a reader would expect to be safe.
 */
const CONSUMER_CONCURRENCY: Readonly<Record<StageClass, ConsumerConcurrency>> = {
    prod: { reserved: PROD_CONSUMER_CONCURRENCY, maximumConcurrency: PROD_CONSUMER_CONCURRENCY },
    // ⛔ No `maximumConcurrency` key at all. See the module docstring: AWS's minimum is 2, so one-at-a-time
    // is expressed by leaving the mapping unconfigured, never by a 1 it would refuse.
    'non-prod': { reserved: 1 },
};

/**
 * Which class a stage belongs to.
 *
 * ⛔ EXACT EQUALITY, never a prefix. `pr-1` shares no prefix with `prod`, but `production` does — and the
 * direction that fails is admitting a stage into the SCALED class by accident, which spends money against a
 * ceiling that stage does not have.
 *
 * @param stage - The deploy stage.
 * @returns Its class.
 */
export function stageClassOf(stage: string): StageClass {
    return stage === 'prod' ? 'prod' : 'non-prod';
}

/**
 * The concurrency pair for a stage.
 *
 * @param stage - The deploy stage.
 * @returns What may run, and what the poller may start.
 */
export function consumerConcurrencyFor(stage: string): ConsumerConcurrency {
    return CONSUMER_CONCURRENCY[stageClassOf(stage)];
}
