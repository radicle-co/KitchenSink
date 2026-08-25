/**
 * THE ONE SPEND SERIES — the CloudWatch identity of ADR-0024's shared $100/month pool.
 *
 * DESIGN PATTERN: a **shared constant module**, extracted for one reason: the pool now has TWO claimants
 * (KTD-17) and both must report into the SAME series, or layer 4's alarm watches half the money.
 *
 * ## ⛔ WHY THE NAMESPACE AND METRIC NAME ARE NOT DUPLICATED PER CONSUMER
 *
 * ADR-0024 layer 4 alarms on a dollar figure, and the owner ruling of 2026-08-24 makes that figure a SINGLE
 * global pool shared by the verification gate, the ingredient parse leg (plan U18) and 017's capture tiers.
 * A second consumer emitting under a name of its own would be invisible to the alarm the ceiling depends on —
 * the pool could be emptied entirely by a path the dashboard does not chart. So the series is one, and the
 * claimant rides on the `CallSite` DIMENSION (`SPEND_CALL_SITES` in
 * `@kitchensink/recipe-core/spend/spend-arithmetic`).
 *
 * ⚠️ `infra/lib/RecipeWorkersStack.ts` pins these same two strings for its alarms and its dashboard, and says
 * so in its own comment. They are matched by EXACT string extraction on the CloudWatch side, so a change here
 * is a change there in the same commit.
 *
 * ## ⚠️ `VerificationSpendMicros` IS NOW A MISNOMER, AND RENAMING IT IS NOT FREE
 *
 * The name predates the parse leg, and read literally it now under-describes what it measures. It is kept
 * because a CloudWatch metric name IS the metric's identity: renaming it starts a new empty series, breaks
 * every alarm and dashboard widget pinned to the old one, and discards the history the ceiling is judged
 * against — for a cosmetic gain. If it is ever renamed it is an infra change with its own PR, not a side
 * effect of adding a consumer.
 */

/**
 * The namespace both spend emitters publish into.
 *
 * ⛔ MUST EQUAL the constant of the same name in `infra/lib/RecipeWorkersStack.ts`.
 */
export const SPEND_METRIC_NAMESPACE = 'Commise/RecipeVerification';

/**
 * The dollar metric ADR-0024's layer 4 alarms on, in MICRO-dollars.
 *
 * ⛔ Layer 4 detects counter BUGS, not a bypass — an earlier draft of the ADR claimed otherwise and was
 * corrected. This metric is emitted BY the gated paths, so a caller that skipped the gate emits nothing. The
 * bypass control is IAM (layer 4b): `bedrock:InvokeModel` on exactly one execution role, asserted by a guard
 * test. A permission nobody else holds cannot be bypassed; a metric nobody else emits cannot notice.
 *
 * ⚠️ Published with unit `None`: CloudWatch has no currency unit, so the denomination lives in the NAME. Do
 * not "fix" it to `Count` — a dashboard would read $0.000116 as a count of 116.
 */
export const SPEND_METRIC_NAME = 'VerificationSpendMicros';

/**
 * Fires when a settlement failed, i.e. a reservation stands unrefunded. ADR-0024 asks for exactly this.
 *
 * ⛔ SHARED BY BOTH CONSUMERS, for the same reason the dollar metric is. A settle failure means a worst-case
 * charge stands against the ONE counter, and the operator's response does not depend on which leg took it —
 * so the alarm already deployed on this name (`RecipeWorkersStack.ts`) covers the parse leg from its first
 * invocation, rather than waiting for a second alarm nobody has written yet.
 *
 * ⚠️ Deliberately carries NO `CallSite`, unlike {@link SPEND_METRIC_NAME}. Only a claim on the shared POOL
 * needs a claimant: this is a count of bookkeeping failures, the two emitters' log lines already name which
 * leg failed and against which period, and a dimension here would double a billed series to say something
 * the logs say better.
 */
export const SETTLE_FAILURE_METRIC_NAME = 'VerificationSettleFailures';
