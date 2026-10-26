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
 * @param exhausted - Keys the gate gave up on (an attempts row with a failure code). Defaults to none.
 * @returns The stub, pre-cast to the DAL type.
 */
export function fakeLineVerificationsDal(
    bands: ReadonlyMap<string, VerificationBand> = new Map(),
    exhausted: ReadonlySet<string> = new Set(),
): LineVerificationsDal {
    return {
        findBandsByKeys: vi.fn().mockImplementation((keys: readonly string[]) =>
            Promise.resolve(
                new Map(
                    [...bands]
                        .filter(([key]) => keys.includes(key))
                        // Migration 0042: the DAL answers full rows. Callers of this fixture speak in
                        // bands; the row's per-aspect halves default to the pre-0042 population (null),
                        // which keeps every existing treatment. ADR-0071: the verdict asked both aspects,
                        // as every producer now asks them.
                        .map(([key, band]) => [
                            key,
                            { band, certainty: 'high', identityVerdict: null, aspects: ['identity', 'quantity'] },
                        ]),
                ),
            ),
        ),
        // ADR-0071: the save path's dedup read. A verdict of ANY band counts as on record (each of these asked identity).
        findExistingKeys: vi
            .fn()
            .mockImplementation((keys: readonly string[]) =>
                Promise.resolve(new Set(keys.filter((key) => bands.has(key)))),
            ),
        // ADR-0071: the keys the gate gave up on.
        findExhaustedKeys: vi
            .fn()
            .mockImplementation((keys: readonly string[]) =>
                Promise.resolve(new Set(keys.filter((key) => exhausted.has(key)))),
            ),
        // ADR-0024 §3: no review was refused by the spend ceiling unless a test says so.
        findBudgetSpentKeys: vi.fn().mockResolvedValue(new Set()),
    } as unknown as LineVerificationsDal;
}
