// @vitest-environment node
/**
 * U20 — the one function on every viewer's request path reports its own failures.
 *
 * ⛔ WHY IT NEEDS ITS OWN PATH. ADR-0042 leaves Lambda@Edge out of the log drain on purpose: a replica writes
 * to a log group in whichever region served the viewer, and no single stack can enumerate them. So an
 * unexpected throw in the verifier returned a CloudFront error to a real viewer and was recorded NOWHERE.
 *
 * ⛔ AND WHY IT IS NOT THE SDK. A viewer-request function's code limit is 1 MB — the bundle exists at all
 * because `dist-lambda` was too big for it — and Lambda@Edge cannot read environment variables, so an SDK
 * that reads `SENTRY_DSN` at init would initialise to nothing. What is left is the part that matters: one
 * POST of one envelope, with the DSN compiled in exactly as the Clerk key is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildEnvelope, EDGE_REPORT_DEADLINE_MS, reportEdgeFailure } from '../src/edge-verifier/edgeObservability.js';

const DSN = 'https://abc123@o1.ingest.sentry.io/456';

/**
 * ⚠️ `parseDsn`'S OWN CASES MOVED, they were not dropped. The parser is now shared with the platform
 * functions' reporter (plan U18) and lives in `src/observability/sentryEnvelope.ts`, so its cases live
 * beside it in `silentNoOp.test.ts` — a Sentry DSN's shape is one piece of knowledge and a second copy of
 * the tests would drift the same way a second copy of the parser would. What stays here is what is
 * genuinely the EDGE's: the exception-shaped envelope, the 400ms deadline, and the rule that a reporting
 * failure never changes the verifier's answer.
 */
const CONTEXT = { stage: 'prod', distributionId: 'E1EXAMPLE' };

describe('buildEnvelope', () => {
    it('carries the error type, the stage and the distribution', () => {
        const envelope = buildEnvelope(new TypeError('verifier blew up'), CONTEXT);

        expect(envelope).toContain('TypeError');
        expect(envelope).toContain('verifier blew up');
        expect(envelope).toContain('E1EXAMPLE');
        expect(envelope).toContain('prod');
    });

    /**
     * ⛔ NO REQUEST HEADERS, NO TOKEN, NO URI. The event this function is handed carries a viewer's
     * `Authorization` header and their path; neither may reach Sentry. What is sent is the error and two
     * identifiers — the same rule `@kitchensink/queue-check`'s payload enforces for the backstops.
     */
    it('⛔ carries NOTHING from the request', () => {
        const envelope = buildEnvelope(new Error('boom'), CONTEXT);
        const parsed = JSON.parse(envelope.split('\n')[2] ?? '{}') as Record<string, unknown>;

        expect(Object.keys(parsed).sort()).toEqual(['environment', 'exception', 'level', 'platform', 'tags']);
        expect(envelope).not.toContain('authorization');
        expect(envelope).not.toContain('Bearer');
    });

    it('survives a non-Error throwable', () => {
        expect(buildEnvelope('a string', CONTEXT)).toContain('NonError');
    });
});

describe('reportEdgeFailure', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts one envelope to the ingest endpoint', async () => {
        const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);

        expect(await reportEdgeFailure(new Error('boom'), CONTEXT, DSN)).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://o1.ingest.sentry.io/api/456/envelope/');
    });

    it('sends nothing, and does not throw, with no DSN compiled in', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);

        expect(await reportEdgeFailure(new Error('boom'), CONTEXT, '')).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    /**
     * ⛔ A SENTRY OUTAGE MUST NOT REACH THE VIEWER. This sits on the request path for everybody; telemetry
     * that can fail a request is strictly worse than no telemetry.
     */
    it('⛔ swallows a transport failure and reports that it did not send', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sentry unreachable')));

        await expect(reportEdgeFailure(new Error('boom'), CONTEXT, DSN)).resolves.toBe(false);
    });

    it('⛔ bounds itself well inside the function timeout', () => {
        // The verifier's own timeout is 5s (`EdgeStack`). A report that could consume it would turn a
        // reporting hiccup into a viewer-visible latency spike.
        expect(EDGE_REPORT_DEADLINE_MS).toBeLessThan(1_000);
        expect(EDGE_REPORT_DEADLINE_MS).toBeGreaterThan(0);
    });

    it('passes an abort signal, so a SLOW Sentry is abandoned rather than awaited', async () => {
        const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);

        await reportEdgeFailure(new Error('boom'), CONTEXT, DSN);

        const init = fetchSpy.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;
        expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
});
