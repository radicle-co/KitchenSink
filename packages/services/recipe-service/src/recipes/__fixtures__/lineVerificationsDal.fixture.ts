/**
 * Test fixture: a fake {@link LineVerificationsDal} for constructing `RecipesService` in unit tests.
 *
 * ⛔ THE DEFAULT IS AN EMPTY MAP, and that is the CORRECT default rather than a convenience. Migration
 * 0023's standing rule is that ABSENCE OF A VERDICT MEANS PUBLISH: the gate runs off a queue, so an
 * unjudged line must behave exactly as it did before the gate existed. Every suite that is not about
 * verification therefore gets, and should get, the pre-gate behaviour — and any test that goes green only
 * because a verdict was absent is testing the same thing production does most of the time.
 *
 * ⚠️ Keys are VERIFICATION KEYS (`{version}:{sha256hex}`), not line ids and not source lines. A test that
 * wants a withheld line derives the key the way production does — `verifiedLineIdentity` + `sha256Hex` +
 * `verificationKey` — which is what makes the round trip through the service an assertion rather than a
 * restatement of the mock.
 */
import { vi } from 'vitest';

import type { LineVerificationsDal } from '../dal/lineVerifications.dal.js';
import type { VerificationBand } from '../domain/lineVerification.js';

/**
 * A `LineVerificationsDal` stub answering with the given verdicts.
 *
 * @param bands - Verdict key → band. Defaults to none, i.e. the gate has judged nothing.
 * @returns The stub, pre-cast to the DAL type.
 */
export function fakeLineVerificationsDal(
    bands: ReadonlyMap<string, VerificationBand> = new Map(),
): LineVerificationsDal {
    return {
        findBandsByKeys: vi
            .fn()
            .mockImplementation((keys: readonly string[]) =>
                Promise.resolve(new Map([...bands].filter(([key]) => keys.includes(key)))),
            ),
    } as unknown as LineVerificationsDal;
}
