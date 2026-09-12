/**
 * `retryOnceWhenSoon` — PATCH resolve's wait (ADR-0053 §4, U27 blueprint): a cook is waiting, so a refusal that clears
 * within two seconds is worth one wait and one retry; anything later answers busy at once.
 */
import { describe, expect, it } from 'vitest';

import { SourceAccountingError, SourceBusyError, isSourceBusyError } from '../../foodSource.errors.js';
import { BUSY_RETRY_MARGIN_MS, retryOnceWhenSoon } from '../busyRetry.js';

/** 2026-10-01 06:00:00 UTC. */
const NOW = Date.UTC(2026, 9, 1, 6, 0, 0);

/** A call that throws each of `failures` in turn, then answers `ok`; and the waits it was given. */
function scripted(failures: readonly unknown[]) {
    let calls = 0;
    const waits: number[] = [];

    return {
        call: async (): Promise<string> => {
            const failure = failures[calls];
            calls += 1;

            if (failure !== undefined) {
                throw failure;
            }

            return 'ok';
        },
        options: {
            maxWaitMs: 2_000,
            now: () => NOW,
            sleep: async (ms: number) => void waits.push(ms),
        },
        calls: () => calls,
        waits,
    };
}

/** A busy refusal that clears `inMs` from {@link NOW}. */
function busy(inMs: number, reason: 'ceiling' | 'blocked' | 'contended' = 'contended'): SourceBusyError {
    return new SourceBusyError('usda', reason, new Date(NOW + inMs).toISOString());
}

describe('retryOnceWhenSoon', () => {
    it('answers without waiting when the first call is admitted', async () => {
        const run = scripted([]);

        await expect(retryOnceWhenSoon(run.call, run.options)).resolves.toBe('ok');
        expect(run.calls()).toBe(1);
        expect(run.waits).toEqual([]);
    });

    it.each([0, 1_000, 2_000])(
        'waits until a refusal clearing in %i ms has cleared, then retries once',
        async (inMs) => {
            const run = scripted([busy(inMs)]);

            await expect(retryOnceWhenSoon(run.call, run.options)).resolves.toBe('ok');
            // Just past the instant the refusal clears, so the retry is not refused for landing early.
            expect(run.waits).toEqual([inMs + BUSY_RETRY_MARGIN_MS]);
            expect(run.calls()).toBe(2);
        },
    );

    it('answers busy at once when the refusal clears later than the wait allows', async () => {
        const run = scripted([busy(2_001, 'ceiling')]);

        const thrown = await retryOnceWhenSoon(run.call, run.options).catch((error: unknown) => error);

        expect(isSourceBusyError(thrown) && thrown.reason).toBe('ceiling');
        expect(run.calls()).toBe(1);
        expect(run.waits).toEqual([]);
    });

    it('waits once only: a second refusal is the answer', async () => {
        const second = busy(500, 'blocked');
        const run = scripted([busy(500), second]);

        await expect(retryOnceWhenSoon(run.call, run.options)).rejects.toBe(second);
        expect(run.calls()).toBe(2);
    });

    it('never waits on a failure that is not a refusal', async () => {
        const failure = new SourceAccountingError('usda', 'admit', new Error('database down'));
        const run = scripted([failure]);

        await expect(retryOnceWhenSoon(run.call, run.options)).rejects.toBe(failure);
        expect(run.calls()).toBe(1);
    });
});
