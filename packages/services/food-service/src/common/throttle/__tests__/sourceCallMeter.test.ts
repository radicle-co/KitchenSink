/**
 * The source-call meter: how many source calls a request's work had admitted against the shared window, counted where
 * the window is charged, so the requester budget refunds exactly the calls that were not made.
 *
 * The inner admission policy is a double; the meter and its decorator are real.
 *
 * @module
 */
import { describe, expect, it, vi } from 'vitest';

import type { Admission, AdmissionPolicy } from '../../../sources/transport/transportPorts.js';
import { MeteredAdmission } from '../meteredAdmission.js';
import { SourceCallMeter } from '../sourceCallMeter.js';
import { isSourceCallMeterSealedError } from '../sourceCallMeter.errors.js';

const ADMITTED: Admission = { admitted: true };
const REFUSED: Admission = { admitted: false, reason: 'ceiling', retryAt: '2026-10-02T10:00:00.000Z' };

/**
 * An inner policy answering each admission in turn, or throwing an `Error` answer.
 *
 * @param answers - What each call answers.
 * @returns The policy and its spy.
 */
function innerAnswering(
    ...answers: (Admission | Error)[]
): AdmissionPolicy & { readonly admit: ReturnType<typeof vi.fn> } {
    const queue = [...answers];

    return {
        admit: vi.fn(async (): Promise<Admission> => {
            const answer = queue.shift() ?? ADMITTED;

            if (answer instanceof Error) {
                throw answer;
            }

            return answer;
        }),
    };
}

describe('MeteredAdmission outside a metered request', () => {
    it('passes every admission through unchanged, as a worker composes it', async () => {
        const inner = innerAnswering(ADMITTED, REFUSED);
        const metered = new MeteredAdmission(inner);

        await expect(metered.admit('usda', 'worker')).resolves.toBe(ADMITTED);
        await expect(metered.admit('usda', 'worker')).resolves.toBe(REFUSED);
        expect(inner.admit).toHaveBeenCalledWith('usda', 'worker');
    });
});

describe('SourceCallMeter', () => {
    it('counts each admitted call, and only those', async () => {
        const metered = new MeteredAdmission(innerAnswering(ADMITTED, REFUSED, ADMITTED));
        const meter = new SourceCallMeter();

        await meter.run(async () => {
            await metered.admit('usda', 'interactive');
            await metered.admit('usda', 'interactive');
            await metered.admit('usda', 'interactive');
        });

        expect(meter.seal()).toBe(2);
    });

    it('does not count an admission that failed, and passes the failure on unchanged', async () => {
        const failure = new Error('limiter down');
        const metered = new MeteredAdmission(innerAnswering(failure));
        const meter = new SourceCallMeter();

        await expect(meter.run(async () => metered.admit('usda', 'interactive'))).rejects.toBe(failure);
        expect(meter.seal()).toBe(0);
    });

    it('counts calls made across a fan-out, each source asked at once', async () => {
        const metered = new MeteredAdmission(innerAnswering(ADMITTED, ADMITTED, REFUSED));
        const meter = new SourceCallMeter();

        await meter.run(async () => Promise.all([1, 2, 3].map(async () => metered.admit('usda', 'interactive'))));

        expect(meter.seal()).toBe(2);
    });

    // An admission still waiting when the request ends may yet be granted, so it counts as used: over-counting keeps
    // the refund from giving back a call that happens.
    it('counts an admission still in flight at seal as used', async () => {
        let grant: (answer: Admission) => void = () => undefined;
        const inner: AdmissionPolicy = {
            admit: async () =>
                new Promise<Admission>((resolve) => {
                    grant = resolve;
                }),
        };
        const metered = new MeteredAdmission(inner);
        const meter = new SourceCallMeter();
        let pending: Promise<Admission> = Promise.resolve(ADMITTED);

        await meter.run(async () => {
            pending = metered.admit('usda', 'interactive');
        });

        expect(meter.seal()).toBe(1);
        grant(ADMITTED);
        await expect(pending).resolves.toBe(ADMITTED);
    });

    // Work the request started and did not wait for keeps the request's context after the request settled.
    it('refuses an admission its request asks after seal, without asking the window', async () => {
        const inner = innerAnswering(ADMITTED);
        const metered = new MeteredAdmission(inner);
        const meter = new SourceCallMeter();
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let late: Promise<Admission> = Promise.resolve(ADMITTED);

        await meter.run(async () => {
            late = (async (): Promise<Admission> => {
                await gate;

                return metered.admit('usda', 'interactive');
            })();
        });
        meter.seal();
        release();

        const refusal: unknown = await late.catch((error: unknown) => error);

        expect(isSourceCallMeterSealedError(refusal)).toBe(true);
        expect(inner.admit).not.toHaveBeenCalled();
    });

    it('keeps two requests running at once on their own counts', async () => {
        const metered = new MeteredAdmission(innerAnswering());
        const one = new SourceCallMeter();
        const two = new SourceCallMeter();

        await Promise.all([
            one.run(async () => {
                await metered.admit('usda', 'interactive');
            }),
            two.run(async () => {
                await metered.admit('usda', 'interactive');
                await metered.admit('usda', 'interactive');
                await metered.admit('usda', 'interactive');
            }),
        ]);

        expect(one.seal()).toBe(1);
        expect(two.seal()).toBe(3);
    });

    it('returns what the work returns', async () => {
        await expect(new SourceCallMeter().run(async () => 'answer')).resolves.toBe('answer');
    });

    it('seals once: a second seal reports the same count', async () => {
        const metered = new MeteredAdmission(innerAnswering());
        const meter = new SourceCallMeter();

        await meter.run(async () => metered.admit('usda', 'interactive'));

        expect(meter.seal()).toBe(1);
        expect(meter.seal()).toBe(1);
    });
});
