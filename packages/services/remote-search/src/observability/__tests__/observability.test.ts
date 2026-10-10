/**
 * Sentry for the search function: inert without a DSN, initialised once from the environment with the shared
 * scrubbers, and an error line handed to Sentry INSTEAD of stdout once it is live (the drain forwards stdout, so a line
 * written to both would be recorded twice).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
    init: vi.fn(),
    flush: vi.fn(() => Promise.resolve(true)),
    logger: { error: vi.fn() },
}));

vi.mock('@sentry/aws-serverless', () => sentry);

/**
 * A fresh copy of the module, as a new Lambda container loads it.
 *
 * @returns The module.
 */
async function freshObservability(): Promise<typeof import('../observability.js')> {
    vi.resetModules();

    return import('../observability.js');
}

beforeEach(() => {
    sentry.init.mockClear();
    sentry.flush.mockClear();
    sentry.logger.error.mockClear();
});

describe('initObservability', () => {
    it('stays inert with no DSN, and leaves every error line to stdout', async () => {
        const { initObservability, reportErrorLine } = await freshObservability();

        expect(initObservability({ STAGE: 'pr-91' })).toBe(false);
        expect(reportErrorLine('remote-search-failed', { rid: 'r' })).toBe(false);
        expect(sentry.init).not.toHaveBeenCalled();
        expect(sentry.logger.error).not.toHaveBeenCalled();
    });

    it('initialises once from the environment, scrubbing every event and log', async () => {
        const { initObservability } = await freshObservability();
        const { scrubEvent, scrubLog } = await import('@kitchensink/observability-scrubbers');

        expect(
            initObservability({ SENTRY_DSN: 'https://key@sentry.test/1', STAGE: 'pr-91', SENTRY_RELEASE: 'abc123' }),
        ).toBe(true);
        expect(initObservability({ SENTRY_DSN: 'https://key@sentry.test/1', STAGE: 'pr-91' })).toBe(true);
        expect(sentry.init).toHaveBeenCalledTimes(1);
        expect(sentry.init).toHaveBeenCalledWith(
            expect.objectContaining({
                dsn: 'https://key@sentry.test/1',
                environment: 'pr-91',
                release: 'abc123',
                enableLogs: true,
                sendDefaultPii: false,
                beforeSend: scrubEvent,
                beforeSendLog: scrubLog,
            }),
        );
    });

    it('names no release when none is configured, rather than one called "undefined"', async () => {
        const { initObservability } = await freshObservability();

        initObservability({ SENTRY_DSN: 'https://key@sentry.test/1', STAGE: 'prod' });

        expect(sentry.init.mock.calls[0]?.[0]).not.toHaveProperty('release');
    });
});

describe('reportErrorLine', () => {
    it('hands the line to Sentry once it is live, and says so', async () => {
        const { initObservability, reportErrorLine } = await freshObservability();

        initObservability({ SENTRY_DSN: 'https://key@sentry.test/1', STAGE: 'prod' });

        expect(reportErrorLine('remote-search-failed', { rid: 'r', status: 500 })).toBe(true);
        expect(sentry.logger.error).toHaveBeenCalledWith('remote-search-failed', { rid: 'r', status: 500 });
    });
});

describe('flushObservability', () => {
    it('sends nothing while Sentry is not live', async () => {
        const { flushObservability } = await freshObservability();

        await flushObservability();

        expect(sentry.flush).not.toHaveBeenCalled();
    });

    it('waits, within a bound, for what Sentry has buffered once it is live', async () => {
        const { flushObservability, initObservability } = await freshObservability();

        initObservability({ SENTRY_DSN: 'https://key@sentry.test/1', STAGE: 'prod' });
        await flushObservability();

        expect(sentry.flush).toHaveBeenCalledWith(2_000);
    });
});
