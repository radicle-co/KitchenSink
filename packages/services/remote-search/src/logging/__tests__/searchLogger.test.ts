/**
 * The production logger: info and warn go to stdout as structured JSON, and an error line goes to Sentry instead of
 * stdout once Sentry is live, or to stdout when it is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const observability = vi.hoisted(() => ({ reportErrorLine: vi.fn<(message: string) => boolean>() }));

vi.mock('../../observability/observability.js', () => observability);

import { createSearchLogger } from '../searchLogger.js';

/** Everything written to stdout and stderr during the case. */
let written = '';

beforeEach(() => {
    written = '';
    observability.reportErrorLine.mockReset();

    for (const stream of [process.stdout, process.stderr]) {
        vi.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => {
            written += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');

            return true;
        });
    }
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('createSearchLogger', () => {
    it('writes info and warn lines to stdout, never to Sentry', () => {
        const logger = createSearchLogger();

        logger.info('remote-search', { status: 200 });
        logger.warn('remote-search', { status: 504 });

        expect(written).toContain('"status":200');
        expect(written).toContain('"status":504');
        expect(observability.reportErrorLine).not.toHaveBeenCalled();
    });

    it('hands an error line to Sentry, and writes nothing, when Sentry takes it', () => {
        observability.reportErrorLine.mockReturnValue(true);

        createSearchLogger().error('remote-search-failed', { status: 500, errorName: 'RangeError' });

        expect(observability.reportErrorLine).toHaveBeenCalledWith('remote-search-failed', {
            status: 500,
            errorName: 'RangeError',
        });
        expect(written).toBe('');
    });

    it('writes an error line to stdout when Sentry is not live', () => {
        observability.reportErrorLine.mockReturnValue(false);

        createSearchLogger().error('remote-search-failed', { status: 500 });

        expect(written).toContain('remote-search-failed');
    });
});
