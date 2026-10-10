/**
 * Unit tests for the food client's DRIFT LAYER 3 (Skew) comparison — `docs/CODING_STANDARDS.md` §15.2.5.
 *
 * These tests encode the owner's ruling (2026-08-11) as executable specification: a contract-hash mismatch
 * **WARNS**, it does not refuse. Every assertion below is written to FAIL if the implementation drifts toward
 * either failure mode the ruling forbids:
 *
 *   - **Deleting the comparison** → `warns once when the service serves a different fingerprint` fails.
 *   - **Making a mismatch throw / reject** → `never rejects` and `never throws synchronously` fail.
 *   - **Treating an ABSENT field as a mismatch** → `stays silent when the service publishes no fingerprint`
 *     fails. This is the case a pre-publication deployment is in, so getting it wrong makes every older
 *     service noisy.
 *   - **Warning per call instead of once** → `warns ONCE per origin, not per request` fails.
 *   - **Probing on construction / on every request** → `probes at most once per origin` fails.
 */
import { CONTRACT_HASH } from '@kitchensink/schema-food';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
    checkContractSkew,
    compareContractHashes,
    reportContractSkewOnce,
    resetContractSkewLatchForTests,
} from '../contractSkew.js';

/** A well-formed fingerprint that is deliberately NOT this client's pinned one. */
const OTHER_HASH = 'a'.repeat(64);

const BASE = 'http://food.example.test';
const OTHER_BASE = 'http://food-two.example.test';

/** A `vi.fn()` that also satisfies `typeof fetch`, so it can be injected AND asserted on. */
type FetchDouble = ReturnType<typeof vi.fn> & typeof fetch;

/**
 * A `fetch` double answering every call with `status` and `body` (JSON-encoded).
 *
 * A FRESH `Response` per call, not one shared instance: a `Response` body is a single-use stream, so a reused
 * instance makes the second call throw "Body is unusable" — which the probe correctly swallows into silence,
 * silently voiding any test that expects a second warning.
 */
function stubFetch(status: number, body: unknown): FetchDouble {
    return vi
        .fn()
        .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as FetchDouble;
}

// The once-latch is module scope BY DESIGN (see the module doc: a client instance is minted per keystroke, so
// per-instance latching would probe per keystroke). Clearing it per test is what keeps these cases
// order-independent — without it, the first test would consume the latch and the rest would pass vacuously.
beforeEach(() => {
    resetContractSkewLatchForTests();
});

describe('compareContractHashes (the pure decision)', () => {
    it('is a match only when both sides are the identical well-formed fingerprint', () => {
        expect(compareContractHashes(CONTRACT_HASH, CONTRACT_HASH)).toBe('match');
    });

    it('is skew when both sides are well-formed and differ', () => {
        expect(compareContractHashes(CONTRACT_HASH, OTHER_HASH)).toBe('skew');
    });

    // An older deployed service predates publication. It is NOT skewed — we simply cannot tell — and
    // reporting it as a mismatch would make every pre-publication deployment noisy.
    it.each([
        ['absent', undefined],
        ['null', null],
        ['an empty string', ''],
        ['a non-string', 12345],
        ['a truncated hash', CONTRACT_HASH.slice(0, 12)],
        ['upper-case hex', CONTRACT_HASH.toUpperCase()],
        ['a non-hex string', 'z'.repeat(64)],
    ])('is INDETERMINATE (never skew) when the served value is %s', (_label, served) => {
        expect(compareContractHashes(CONTRACT_HASH, served)).toBe('indeterminate');
    });

    // If OUR OWN stamp is broken the equality result is meaningless, so there is nothing to report. This is
    // the mirror of the boot assertion's format check, but it resolves to silence rather than a throw,
    // because a client must never be the thing that breaks.
    it('is INDETERMINATE when the pinned side is malformed, rather than reporting a false skew', () => {
        expect(compareContractHashes('', OTHER_HASH)).toBe('indeterminate');
        expect(compareContractHashes('not-a-hash', OTHER_HASH)).toBe('indeterminate');
    });
});

describe('checkContractSkew (the probe)', () => {
    it('warns once when the service serves a different fingerprint', async () => {
        const warn = vi.fn();
        const fetchImpl = stubFetch(200, { status: 'ok', service: 'food', contractHash: OTHER_HASH });

        await checkContractSkew({ baseUrl: BASE, fetch: fetchImpl, warn });

        expect(warn).toHaveBeenCalledTimes(1);
    });

    // "Actionable" is a requirement, not a nicety: a warning that does not say which side is which, or what to
    // do, is noise that gets muted. Both fingerprints must be identifiable and the remedy must be stated.
    it('names both fingerprints, which side is which, and the remedy', async () => {
        const warn = vi.fn();
        const baseUrl = BASE;
        const fetchImpl = stubFetch(200, { status: 'ok', service: 'food', contractHash: OTHER_HASH });

        await checkContractSkew({ baseUrl, fetch: fetchImpl, warn });

        const message = warn.mock.calls[0]?.[0] as string;
        expect(message).toContain(CONTRACT_HASH.slice(0, 12));
        expect(message).toContain(OTHER_HASH.slice(0, 12));
        expect(message).toContain('@kitchensink/schema-food');
        expect(message).toContain(`${baseUrl}/health`);
        expect(message).toMatch(/client/iu);
        expect(message).toMatch(/service/iu);
        expect(message).toMatch(/regenerate|redeploy|rebuild/iu);
        // It must announce itself as a WARNING and say plainly that nothing is blocked, so whoever reads it
        // at 3am does not go hunting for an outage that is not happening.
        expect(message).toMatch(/warning/iu);
        expect(message).toMatch(/nothing is blocked/iu);
        expect(message).toMatch(/continue normally/iu);
    });

    it('stays silent when the fingerprints agree', async () => {
        const warn = vi.fn();
        const fetchImpl = stubFetch(200, { status: 'ok', service: 'food', contractHash: CONTRACT_HASH });

        await checkContractSkew({ baseUrl: BASE, fetch: fetchImpl, warn });

        expect(warn).not.toHaveBeenCalled();
    });

    // THE regression this test exists for: an absent field is not a mismatch. Every deployment made before
    // publication is in exactly this state.
    it('stays silent when the service publishes no fingerprint (an older deployed service)', async () => {
        const warn = vi.fn();
        const fetchImpl = stubFetch(200, { status: 'ok', service: 'food' });

        await checkContractSkew({ baseUrl: BASE, fetch: fetchImpl, warn });

        expect(warn).not.toHaveBeenCalled();
    });

    it.each([
        ['a 503 from the service', 503],
        ['a 404 (misrouted / shared-ALB default)', 404],
        ['a 401', 401],
    ])('stays silent when the health probe itself answers %s', async (_label, status) => {
        const warn = vi.fn();
        const fetchImpl = stubFetch(status, { contractHash: OTHER_HASH });

        await checkContractSkew({ baseUrl: BASE, fetch: fetchImpl, warn });

        expect(warn).not.toHaveBeenCalled();
    });

    it('stays silent when the health body is not JSON at all (an ALB HTML error page)', async () => {
        const warn = vi.fn();
        const fetchImpl = vi
            .fn()
            .mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 200 })) as FetchDouble;

        await checkContractSkew({ baseUrl: BASE, fetch: fetchImpl, warn });

        expect(warn).not.toHaveBeenCalled();
    });

    it('stays silent, and never rejects, when the transport fails outright', async () => {
        const warn = vi.fn();
        const fetchImpl = vi.fn().mockRejectedValue(new Error('ENOTFOUND food.test')) as FetchDouble;

        await expect(checkContractSkew({ baseUrl: BASE, fetch: fetchImpl, warn })).resolves.toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
    });

    // A skew probe must never become the thing that hangs a process. The bound is enforced with a real
    // `AbortSignal`, so a stalled `/health` cannot leave a socket pending for the life of the client.
    it('abandons a hanging probe within its own deadline, and stays silent', async () => {
        const warn = vi.fn();
        const fetchImpl = vi.fn().mockImplementation(
            (_url: string, init?: { signal?: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new Error('aborted'));
                    });
                }),
        ) as FetchDouble;

        await expect(
            checkContractSkew({ baseUrl: BASE, fetch: fetchImpl, warn, timeoutMs: 15 }),
        ).resolves.toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
    });

    // Even a `warn` callback that throws must not turn a diagnostic into a failure — the consumer supplied it,
    // and the skew path is not allowed to propagate anything.
    it('never rejects even when the supplied warn callback throws', async () => {
        const warn = vi.fn().mockImplementation(() => {
            throw new Error('logger exploded');
        });
        const fetchImpl = stubFetch(200, { status: 'ok', service: 'food', contractHash: OTHER_HASH });

        await expect(checkContractSkew({ baseUrl: BASE, fetch: fetchImpl, warn })).resolves.toBeUndefined();
    });

    // The probe is unauthenticated ON PURPOSE: `/health` is public precisely so a consumer can ask about skew
    // before it holds a credential, and a diagnostic must never spend the caller's token.
    it('sends no Authorization header', async () => {
        const warn = vi.fn();
        const fetchImpl = stubFetch(200, { status: 'ok', service: 'food', contractHash: CONTRACT_HASH });

        await checkContractSkew({ baseUrl: BASE, fetch: fetchImpl, warn });

        const init = fetchImpl.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined;
        expect(Object.keys(init?.headers ?? {}).map((key) => key.toLowerCase())).not.toContain('authorization');
    });
});

describe('reportContractSkewOnce (the latch)', () => {
    it('warns ONCE per origin, not per request', async () => {
        const warn = vi.fn();
        const baseUrl = BASE;
        const fetchImpl = stubFetch(200, { status: 'ok', service: 'food', contractHash: OTHER_HASH });

        for (let i = 0; i < 25; i += 1) {
            reportContractSkewOnce({ baseUrl, fetch: fetchImpl, warn });
        }

        await vi.waitFor(() => {
            expect(warn).toHaveBeenCalledTimes(1);
        });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    // The latch must be claimed BEFORE the first `await`, or a burst of concurrent first calls — which is
    // exactly what the per-keystroke typeahead client produces — all pass the check and each fire a probe.
    it('probes at most once per origin even for a synchronous burst of callers', async () => {
        const warn = vi.fn();
        const baseUrl = BASE;
        const fetchImpl = stubFetch(200, { status: 'ok', service: 'food', contractHash: OTHER_HASH });

        for (let i = 0; i < 25; i += 1) {
            reportContractSkewOnce({ baseUrl, fetch: fetchImpl, warn });
        }

        await vi.waitFor(() => {
            expect(warn).toHaveBeenCalledTimes(1);
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('is declared to return nothing, so no caller can accidentally await it on a hot path', () => {
        // Asserted at the TYPE level, not with `expect(fn()).toBeUndefined()`. A `void` signature is the
        // guarantee: under it TypeScript rejects both an `async` implementation and a `return <value>`, which
        // is strictly stronger than observing one call's result — and it retires CodeQL's "use of returnless
        // function" finding, which the runtime form triggered by using a `void` call as a value.
        expectTypeOf(reportContractSkewOnce).returns.toBeVoid();
    });

    it('never throws synchronously, even when fetch throws synchronously', () => {
        const warn = vi.fn();
        const fetchImpl = vi.fn().mockImplementation(() => {
            throw new Error('fetch is not a function');
        }) as FetchDouble;

        expect(() => {
            reportContractSkewOnce({ baseUrl: BASE, fetch: fetchImpl, warn });
        }).not.toThrow();
    });

    it('tracks each origin separately, so a second service is still checked', async () => {
        const warn = vi.fn();
        const fetchImpl = stubFetch(200, { status: 'ok', service: 'food', contractHash: OTHER_HASH });

        reportContractSkewOnce({ baseUrl: BASE, fetch: fetchImpl, warn });
        reportContractSkewOnce({ baseUrl: OTHER_BASE, fetch: fetchImpl, warn });

        await vi.waitFor(() => {
            expect(warn).toHaveBeenCalledTimes(2);
        });
    });
});
