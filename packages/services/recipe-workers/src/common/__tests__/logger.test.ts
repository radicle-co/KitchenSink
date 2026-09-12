/**
 * U22a step 2 — an ERROR line from these ten Lambdas reaches THIS SERVICE'S OWN Sentry project.
 *
 * ⛔ WHAT WAS ACTUALLY BROKEN. `common/observability.ts` shipped `reportErrorLine` in U16 with a docstring
 * (`observability.ts:9-13`) stating the rule in full — "when Sentry is initialised, `logger.error` goes to
 * Sentry's logger INSTEAD of stdout. `info` and `warn` stay on stdout" — and the function had NO CALLER.
 * The module specified the behaviour and the code did not do it, which is the one failure mode a docstring
 * cannot be trusted to reveal: it reads exactly like a description of working code.
 *
 * ⛔ THESE ASSERTIONS WATCH THE STREAMS, NOT A SPY ON `console`. Powertools does not log through the global
 * `console`: outside Lambda it constructs its own `node:console` bound to `process.stdout`/`process.stderr`,
 * so a `vi.spyOn(console, 'error')` observes nothing and a suite built on one would pass with the routing
 * change absent AND with it present. "Instead of stdout" is a claim about bytes, so the bytes are what is
 * asserted.
 *
 * ⛔ AND THE NO-DSN CASE IS THE ONE THAT MUST NOT REGRESS. `Sentry.logger.error` with no client initialised
 * emits NOTHING — no stdout, no stderr, no throw (measured). So a routing change that diverts unconditionally
 * does not move the line, it DELETES it: every local run, the whole unit and integration tier, and any stage
 * whose SSM parameter is unwritten would log nothing at all. The divert is conditional on `reportErrorLine`
 * returning true, and that is what the first case here pins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/** Everything Powertools wrote, across both streams, for the case under test. */
let written: string[] = [];
let restore: Array<() => void> = [];

/**
 * Capture `process.stdout`/`process.stderr` writes. Powertools binds its own console to these two streams,
 * so this is the only vantage point from which "went to stdout" and "did not" are distinguishable.
 *
 * @sideEffect Replaces both streams' `write` for the duration of a case.
 */
function captureStreams(): void {
    for (const stream of [process.stdout, process.stderr]) {
        const original = stream.write.bind(stream);

        restore.push(() => {
            stream.write = original;
        });

        stream.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
            written.push(String(chunk));

            return (original as (...args: never[]) => boolean)(...([chunk, ...rest] as never[]));
        }) as typeof stream.write;
    }
}

/** The module pair under test, loaded fresh so `initialised` starts false in every case. */
async function load(dsn?: string) {
    vi.resetModules();

    const observability = await import('../observability.js');

    if (dsn !== undefined) {
        observability.initObservability({ SENTRY_DSN: dsn, STAGE: 'test' } as NodeJS.ProcessEnv);
    }

    const { logger } = await import('../logger.js');

    return { logger, observability };
}

describe('recipe-workers logger', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        written = [];
        restore = [];
    });

    afterEach(() => {
        for (const undo of restore) {
            undo();
        }
    });

    it('⛔ WITHOUT A DSN an error still reaches the stream — the line is not deleted', async () => {
        const { logger, observability } = await load();

        expect(observability.isObservabilityEnabled()).toBe(false);
        captureStreams();
        logger.error('erasure-sweeper: could not process a stuck job', { jobId: 'j-1' });

        expect(written.join('')).toContain('erasure-sweeper: could not process a stuck job');
        expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('⛔ WITH a DSN the error goes to Sentry INSTEAD of the stream, not as well as', async () => {
        const { logger } = await load('https://k@o0.ingest.sentry.io/1');

        captureStreams();
        logger.error('band drain could not re-drive a pending verification', { jobId: 'j-2', attempt: 3 });

        expect(mockLoggerError).toHaveBeenCalledWith('band drain could not re-drive a pending verification', {
            jobId: 'j-2',
            attempt: 3,
        });
        expect(written.join('')).not.toContain('band drain could not re-drive a pending verification');
    });

    it('⛔ info and warn STAY on the stream even with a DSN — CloudWatch is the durable record', async () => {
        const { logger } = await load('https://k@o0.ingest.sentry.io/1');

        captureStreams();
        logger.info('archive-sweeper: swept', { swept: 4 });
        logger.warn('archive-sweeper: nothing to sweep', { swept: 0 });

        const output = written.join('');

        expect(output).toContain('archive-sweeper: swept');
        expect(output).toContain('archive-sweeper: nothing to sweep');
        expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('⛔ scrubs the attributes on the SENTRY path too, not only on the way to stdout', async () => {
        const { logger } = await load('https://k@o0.ingest.sentry.io/1');

        logger.error('account-erasure-worker: could not record job error', {
            ownerId: '01JQBX8Z0000000000000000',
            email: 'someone@example.com',
        });

        const [, attributes] = mockLoggerError.mock.calls[0] as [string, Record<string, unknown>];

        expect(attributes['ownerId']).not.toBe('01JQBX8Z0000000000000000');
        expect(attributes['email']).not.toBe('someone@example.com');
    });

    it('⚠️ an object-form message is not stringified into the issue title', async () => {
        const { logger } = await load('https://k@o0.ingest.sentry.io/1');

        logger.error({ message: 'handle-sync-worker: rename failed', messageId: 'm-9' });

        expect(mockLoggerError).toHaveBeenCalledWith('handle-sync-worker: rename failed', { messageId: 'm-9' });
    });
});
