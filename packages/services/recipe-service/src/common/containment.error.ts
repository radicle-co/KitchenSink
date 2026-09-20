/**
 * The HTTP failure a test-principal CONTAINMENT denial answers with (ADR-0040): `403 TEST_PRINCIPAL_CONTAINED`.
 *
 * A thin factory over {@link apiError}, so the status comes from the ONE code→status table and never from the call
 * site. The reason is `evaluateContainment`'s (or a composed policy's) own sentence, so the refusal names the write.
 *
 * {@link assertNotContained} is the one check-and-throw a service issues where a contained test principal is REFUSED.
 * A site that NARROWS instead (analytics skipped, a correction's reach) calls `isContained`, and a composed policy
 * that returns its own denial (`evaluateVisibility`) throws {@link testPrincipalContained} on its own decision.
 */
import type { HttpException } from '@nestjs/common';

import { apiError } from './apiError.js';
import {
    evaluateContainment,
    TEST_PRINCIPAL_CONTAINED_CODE,
    type ContainedAction,
    type ContainmentSubject,
} from './containmentPolicy.js';

/**
 * Build the containment denial.
 *
 * @param reason - The denial's human-readable reason, from the policy that refused.
 * @returns The `HttpException` to throw. Pure — constructing it performs no I/O.
 */
export function testPrincipalContained(reason: string): HttpException {
    return apiError(TEST_PRINCIPAL_CONTAINED_CODE, reason);
}

/**
 * Refuse the write when the acting principal is contained on this stage (ADR-0040). A no-op otherwise.
 *
 * @param subject - Who is acting and whether this stage contains them (an `ActingPrincipal` is one).
 * @param action - The write being attempted.
 * @throws {HttpException} `TEST_PRINCIPAL_CONTAINED` (403), with the action's own reason, when a test principal acts
 *   on an enforcing stage.
 */
export function assertNotContained(subject: ContainmentSubject, action: ContainedAction): void {
    const decision = evaluateContainment({
        principalKind: subject.principalKind,
        containment: subject.containment,
        action,
    });

    if (!decision.allowed) {
        throw testPrincipalContained(decision.reason);
    }
}
