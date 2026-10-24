/**
 * U16 — the ten recipe Lambdas report ERRORS, not just log lines.
 *
 * ⛔ WHY IT MATTERS THAT THESE ARE DIFFERENT THINGS. Plan U15 gave this function's log group a drain, so its
 * stdout now reaches Sentry. That is not the same as reporting: a forwarded log line does not group, carries
 * no stack trace Sentry can symbolicate, and nothing alerts on it. Errors and logs are different products,
 * and only one of them pages anybody.
 *
 * ⛔ AND THE TWO PATHS MUST NOT DOUBLE-COUNT. The drain forwards stdout, so an error written to stdout AND
 * captured by the SDK is one failure recorded twice — once as an issue, once as an ERROR-severity log —
 * counted separately by Sentry's alerting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInit, mockWrapHandler, mockLoggerError, mockCaptureException, mockSetAttributes, mockWithScope } =
    vi.hoisted(() => ({
        mockInit: vi.fn(),
        mockWrapHandler: vi.fn((handler: unknown) => handler),
        mockLoggerError: vi.fn(),
        mockCaptureException: vi.fn(),
        mockSetAttributes: vi.fn(),
        mockWithScope: vi.fn((run: (scope: { setContext: () => void }) => void) => {
            run({ setContext: () => undefined });
        }),
    }));

vi.mock('@sentry/aws-serverless', () => ({
    init: mockInit,
    wrapHandler: mockWrapHandler,
    logger: { error: mockLoggerError },
    captureException: mockCaptureException,
    withScope: mockWithScope,
    getIsolationScope: () => ({ setAttributes: mockSetAttributes }),
}));

describe('recipe-workers observability', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    /** A fresh module per case — `initialised` is module state, and these cases drive both branches. */
    async function load() {
        return import('../observability.js');
    }

    it('⛔ is INERT without a DSN — local runs and the unit suite behave exactly as before', async () => {
        const { initObservability, withObservability, isObservabilityEnabled, reportErrorLine } = await load();

        expect(initObservability({} as NodeJS.ProcessEnv)).toBe(false);
        expect(isObservabilityEnabled()).toBe(false);
        expect(mockInit).not.toHaveBeenCalled();

        // ...and the handler it hands back is the SAME function, not a wrapper.
        const original = (): string => 'ran';
        expect(withObservability(original)).toBe(original);
        expect(reportErrorLine('anything')).toBe(false);
    });

    it('initialises with the stage as environment and the commit as release', async () => {
        const { initObservability } = await load();

        expect(
            initObservability({
                SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1',
                STAGE: 'pr-91',
                SENTRY_RELEASE: 'abc123',
            } as NodeJS.ProcessEnv),
        ).toBe(true);

        expect(mockInit).toHaveBeenCalledWith(
            expect.objectContaining({ environment: 'pr-91', release: 'abc123', sendDefaultPii: false }),
        );
    });

    /**
     * ⛔ THE THREE OPTIONS THE ERROR ROUTE DEPENDS ON, asserted because U22a step 2 made them load-bearing.
     *
     * `logger.error` now SUPPRESSES its stdout write whenever `reportErrorLine` returns true, and that
     * return says only "Sentry was initialised" — it cannot see whether the SDK will actually emit. So:
     *
     * - `enableLogs: false` (or absent) makes `Sentry.logger.error` a silent no-op while `reportErrorLine`
     *   still answers true. The line is then dropped by BOTH sinks — the one failure this routing can
     *   cause, and it is invisible: an absence of error logs reads exactly like a healthy quiet system.
     * - `beforeSendLog` is the ONLY scrub on this path. Before this step it guarded nothing, because
     *   nothing called `reportErrorLine`; it now sees every error line these ten functions emit, ingredient
     *   phrases and display names included (ADR-0027).
     * - `beforeSend` is the same guarantee for the issue path `withObservability` installs.
     *
     * Each is asserted by IDENTITY against the shared scrubber, not by presence, so replacing one with a
     * local lambda that forgets a key fails here rather than in production.
     */
    it('⛔ wires enableLogs and BOTH shared scrubbers — the error route is unsafe without all three', async () => {
        const { initObservability } = await load();
        const { scrubEvent, scrubLog } = await import('@kitchensink/observability-scrubbers');

        initObservability({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1', STAGE: 'prod' } as NodeJS.ProcessEnv);

        expect(mockInit).toHaveBeenCalledWith(
            expect.objectContaining({ enableLogs: true, beforeSend: scrubEvent, beforeSendLog: scrubLog }),
        );
    });

    /**
     * ⚠️ OMITTED, not `release: undefined`. A release named "undefined" groups unrelated deploys together,
     * which is harder to notice than no release at all.
     */
    it('omits the release when the build does not know its commit', async () => {
        const { initObservability } = await load();

        initObservability({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1', STAGE: 'prod' } as NodeJS.ProcessEnv);

        expect(mockInit.mock.calls[0]?.[0]).not.toHaveProperty('release');
    });

    it('⛔ a wrapped handler still runs, and carries per-invocation context', async () => {
        const { initObservability, withObservability } = await load();
        initObservability({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1', STAGE: 'prod' } as NodeJS.ProcessEnv);

        const wrapped = withObservability((() => 'ran') as () => string);

        expect(wrapped()).toBe('ran');
        expect(mockWrapHandler).toHaveBeenCalled();
        expect(mockSetAttributes).toHaveBeenCalledWith(expect.objectContaining({ serviceName: 'recipe-workers' }));
    });

    /**
     * ⛔ HALF THESE FUNCTIONS ARE SCHEDULED — invoked by EventBridge with no SQS event, and called by their
     * own suites with no arguments at all. Reading `context.awsRequestId` unguarded would turn "Sentry is
     * enabled" into "every scheduled handler throws on entry", which is the worst way an observability
     * change can fail: it breaks the thing it was meant to watch.
     */
    it('⛔ a SCHEDULED handler called with no arguments does not throw', async () => {
        const { initObservability, withObservability } = await load();
        initObservability({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1', STAGE: 'prod' } as NodeJS.ProcessEnv);

        const wrapped = withObservability((() => 'swept') as () => string);

        expect(wrapped()).toBe('swept');
        expect(mockSetAttributes).toHaveBeenCalledWith(expect.objectContaining({ aws_request_id: 'none' }));
    });

    /**
     * ⛔ INSTEAD OF stdout, not as well as. The drain forwards stdout, so a line written in both places is
     * one failure recorded twice, and Sentry's alerting counts them separately.
     */
    it('⛔ an error line goes to Sentry and is NOT also written to stdout', async () => {
        const { initObservability, reportErrorLine } = await load();
        initObservability({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1', STAGE: 'prod' } as NodeJS.ProcessEnv);

        const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

        try {
            expect(reportErrorLine('something failed', { jobId: 'j1' })).toBe(true);
            expect(mockLoggerError).toHaveBeenCalledWith('something failed', { jobId: 'j1' });
            expect(stdout).not.toHaveBeenCalled();
        } finally {
            stdout.mockRestore();
        }
    });

    it('captures a HANDLED error with its work-unit context', async () => {
        const { initObservability, captureHandled } = await load();
        initObservability({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1', STAGE: 'prod' } as NodeJS.ProcessEnv);

        captureHandled(new Error('swallowed'), { jobId: 'j1', lineIndex: 0 });

        expect(mockCaptureException).toHaveBeenCalled();
    });

    it('is inert for a handled capture without a DSN', async () => {
        const { captureHandled } = await load();

        captureHandled(new Error('swallowed'), { jobId: 'j1' });

        expect(mockCaptureException).not.toHaveBeenCalled();
    });
});
