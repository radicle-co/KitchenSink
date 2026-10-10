/**
 * May this principal ERASE or CLOSE its own identity account? — the test-principal containment Specification.
 *
 * ## Why it exists
 *
 * A TEST PRINCIPAL is a member of the fixed Clerk test pool, marked by the signed claim
 * `public_metadata.testPrincipal === true` (read by `@kitchensink/clerk-verify`, never from an unsigned field).
 * The pool is shared infrastructure: every deployed test run signs in as one of its members. Self-service
 * erasure hands the deletion-worker a Clerk `deleteUser`, and closure hands it a Clerk ban — and R10
 * anti-resurrection then keeps the identity row dead, so the pool member is unusable FOREVER, not merely until
 * the next run. One test driving account erasure against the wrong stage would silently shrink the pool.
 *
 * So under `enforce` (prod, and any stage where the switch is unset) both actions are refused for a test
 * principal; under `off` (sandbox, where the pool's users are disposable and the flows must stay testable) they
 * are admitted. A real user is never affected by either mode.
 *
 * ## Why a policy module and not a route Guard
 *
 * The decision is over a CLAIM on the verified principal plus deployment config, not over a route's
 * authorization requirement — the same layer ADR-0023 ruled on for field-value authorization. Keeping it pure
 * makes the whole input space a truth table (`__tests__/testPrincipalContainment.test.ts`), and `UsersService`
 * consults it BEFORE any database read, S3 call or queue message.
 *
 * @pattern Specification — a pure predicate over `{ testPrincipal, containment, action }`, returning a
 *   discriminated-union decision the caller maps onto its own error envelope.
 * @see docs/architecture/decisions/0040-test-principals-containment-and-purge.md
 */
import type { TestPrincipalContainment } from '../../config/env.schema.js';

/** The self-service lifecycle actions that destroy or disable the caller's Clerk identity. */
export const CONTAINED_ACTIONS = ['eraseAccount', 'closeAccount'] as const;

/** One of {@link CONTAINED_ACTIONS}. */
export type ContainedAction = (typeof CONTAINED_ACTIONS)[number];

/** The machine-readable code a refusal carries onto the wire (identity's `{ code, message }` envelope). */
export const TEST_PRINCIPAL_CONTAINED = 'TEST_PRINCIPAL_CONTAINED';

/** What the Specification is asked about. */
export interface TestPrincipalContainmentInput {
    /** From the verified token: whether the caller is a test-pool member. */
    readonly testPrincipal: boolean;
    /** The deployment's containment mode. */
    readonly containment: TestPrincipalContainment;
    /** The lifecycle action being attempted. */
    readonly action: ContainedAction;
}

/** The decision: admitted, or refused with the code and a log-safe reason. */
export type TestPrincipalContainmentDecision =
    | { readonly allowed: true }
    | { readonly allowed: false; readonly code: typeof TEST_PRINCIPAL_CONTAINED; readonly reason: string };

/**
 * Decide whether the principal may perform the action. Denied iff it is a test principal AND containment is
 * `enforce`. Pure.
 *
 * @param input - The principal's flag, the deployment mode and the action.
 * @returns `{ allowed: true }`, or the refusal carrying {@link TEST_PRINCIPAL_CONTAINED}.
 */
export function evaluateTestPrincipalContainment(
    input: TestPrincipalContainmentInput,
): TestPrincipalContainmentDecision {
    if (input.testPrincipal && input.containment === 'enforce') {
        return {
            allowed: false,
            code: TEST_PRINCIPAL_CONTAINED,
            reason: `Test principals may not perform ${input.action} on this deployment`,
        };
    }

    return { allowed: true };
}
