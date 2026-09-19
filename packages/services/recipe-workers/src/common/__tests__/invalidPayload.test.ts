import { describe, expect, it, vi } from 'vitest';
import { ZodError, z } from 'zod';

import { isInvalidPayload, recordInvalidPayload } from '../invalidPayload.js';
import { logger } from '../logger.js';

/**
 * GR-018 §18-b: "An invalid payload cannot become valid by being sent again." The consumer records the
 * rejection and COMPLETES the message; only a transient dependency failure retries. These two functions are
 * the shared half of that rule — the classification and the record — so the four consumers cannot each
 * decide it differently.
 */
describe('invalid-payload classification', () => {
    it('classifies a JSON syntax error as invalid, never transient', () => {
        let caught: unknown;

        try {
            JSON.parse('nope');
        } catch (error) {
            caught = error;
        }

        expect(isInvalidPayload(caught)).toBe(true);
    });

    it('classifies a schema rejection as invalid', () => {
        const result = z.object({ userId: z.string() }).safeParse({ userId: 7 });

        expect(result.success).toBe(false);
        expect(isInvalidPayload(result.error)).toBe(true);
        expect(isInvalidPayload(new ZodError([]))).toBe(true);
    });

    it('does NOT classify a dependency failure as invalid — that one retries', () => {
        // The distinction GR-018 draws: "The retry that IS legitimate is a transient-dependency failure — a
        // database timeout, a 5xx from a callee." Treating those as invalid would acknowledge real work.
        expect(isInvalidPayload(new Error('connection terminated unexpectedly'))).toBe(false);
        expect(isInvalidPayload(new TypeError('fetch failed'))).toBe(false);
        expect(isInvalidPayload(undefined)).toBe(false);
    });
});

describe('recording an invalid payload', () => {
    it('emits one counted metric, and logs the queue and reason', () => {
        const emitted: unknown[] = [];
        const metricSpy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
            emitted.push(line);
        });
        const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

        recordInvalidPayload({ stage: 'pr-91', queue: 'parse', messageId: 'm-1', error: new ZodError([]) });

        const metricLine = emitted.map(String).find((line) => line.includes('InvalidPayload'));

        expect(metricLine, 'no InvalidPayload metric was emitted').toBeDefined();
        // Dimensioned by Stage alone: EMF bills per distinct dimension-value combination, and the queue and
        // message id ride the log instead, where they cost nothing.
        expect(metricLine).toContain('"Stage"');
        expect(metricLine).not.toContain('m-1');

        expect(logSpy).toHaveBeenCalledOnce();
        expect(logSpy.mock.calls[0]?.[1]).toMatchObject({ queue: 'parse', messageId: 'm-1' });

        metricSpy.mockRestore();
        logSpy.mockRestore();
    });
});
