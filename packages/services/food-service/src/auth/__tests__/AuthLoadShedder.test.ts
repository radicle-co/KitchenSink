/**
 * Unit tests for {@link AuthLoadShedder} (T-054, FR-052/SC-009/SC-011). Pure-ish counter logic over an
 * injected clock: a bounded verification-concurrency gate + a per-source rolling-window `401`-rate cap
 * so a flood of well-formed-but-invalid tokens is shed (cheap `503`) BEFORE the CPU-bound signature
 * verification, instead of saturating the verifier and breaching the ≤10ms p95 (SC-011).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthLoadShedder } from '../AuthLoadShedder.js';

describe('AuthLoadShedder — verification concurrency bound (FR-052)', () => {
    it('grants up to maxConcurrent slots, then refuses until one is released', () => {
        const shedder = new AuthLoadShedder({ maxConcurrent: 2, shedThreshold: 1000, shedWindowMs: 1000 });

        expect(shedder.tryAcquire()).toBe(true);
        expect(shedder.tryAcquire()).toBe(true);
        expect(shedder.tryAcquire()).toBe(false); // saturated → shed

        shedder.release();
        expect(shedder.tryAcquire()).toBe(true);
    });

    it('reports in-flight count', () => {
        const shedder = new AuthLoadShedder({ maxConcurrent: 4, shedThreshold: 1000, shedWindowMs: 1000 });
        shedder.tryAcquire();
        shedder.tryAcquire();

        expect(shedder.inFlight()).toBe(2);
    });
});

describe('AuthLoadShedder — per-source 401-rate cap (FR-052/SC-011)', () => {
    let now: number;
    const clock = (): number => now;

    beforeEach(() => {
        now = 1_000_000;
    });

    it('does not shed a source below the failure threshold', () => {
        const shedder = new AuthLoadShedder({ maxConcurrent: 100, shedThreshold: 3, shedWindowMs: 10_000, now: clock });

        shedder.recordFailure('1.2.3.4');
        shedder.recordFailure('1.2.3.4');

        expect(shedder.shouldShed('1.2.3.4')).toBe(false);
    });

    it('sheds a source once its failures reach the threshold inside the window', () => {
        const shedder = new AuthLoadShedder({ maxConcurrent: 100, shedThreshold: 3, shedWindowMs: 10_000, now: clock });

        shedder.recordFailure('1.2.3.4');
        shedder.recordFailure('1.2.3.4');
        shedder.recordFailure('1.2.3.4');

        expect(shedder.shouldShed('1.2.3.4')).toBe(true);
    });

    it('isolates sources — a flooding source does not shed a different source', () => {
        const shedder = new AuthLoadShedder({ maxConcurrent: 100, shedThreshold: 2, shedWindowMs: 10_000, now: clock });

        shedder.recordFailure('9.9.9.9');
        shedder.recordFailure('9.9.9.9');

        expect(shedder.shouldShed('9.9.9.9')).toBe(true);
        expect(shedder.shouldShed('1.1.1.1')).toBe(false);
    });

    it('self-heals: failures age out of the rolling window so a source recovers', () => {
        const shedder = new AuthLoadShedder({ maxConcurrent: 100, shedThreshold: 2, shedWindowMs: 10_000, now: clock });

        shedder.recordFailure('1.2.3.4');
        shedder.recordFailure('1.2.3.4');
        expect(shedder.shouldShed('1.2.3.4')).toBe(true);

        now += 10_001; // entire window elapses
        expect(shedder.shouldShed('1.2.3.4')).toBe(false);
    });
});

describe('AuthLoadShedder — source key extraction', () => {
    it('prefers the leftmost X-Forwarded-For hop, else the socket address', () => {
        const shedder = new AuthLoadShedder({ maxConcurrent: 1, shedThreshold: 1, shedWindowMs: 1 });

        expect(shedder.sourceKey({ xForwardedFor: '203.0.113.7, 10.0.0.1', ip: '10.0.0.9' })).toBe('203.0.113.7');
        expect(shedder.sourceKey({ xForwardedFor: undefined, ip: '10.0.0.9' })).toBe('10.0.0.9');
        expect(shedder.sourceKey({ xForwardedFor: undefined, ip: undefined })).toBe('unknown');
    });
});

describe('AuthLoadShedder — bounded source tracking (finding 02.F-F1 / 08.F-SEC1)', () => {
    let now: number;
    const clock = (): number => now;

    beforeEach(() => {
        now = 1_000_000;
    });

    /**
     * The bucket key is the leftmost `X-Forwarded-For` hop, and the ALB APPENDS to that header rather than
     * replacing it — so an unauthenticated client picks its own key, and picks a fresh one every request.
     * Without a bound the defence against a DoS is itself the DoS: one Map entry per request, forever,
     * until the task is OOM-killed.
     */
    it('never tracks more sources than the cap, however many distinct keys a flood invents', () => {
        const shedder = new AuthLoadShedder({
            shedThreshold: 5,
            shedWindowMs: 10_000,
            maxTrackedSources: 100,
            now: clock,
        });

        for (let i = 0; i < 10_000; i += 1) {
            shedder.recordFailure(`10.0.0.${i}`);
        }

        expect(shedder.trackedSources()).toBeLessThanOrEqual(100);
    });

    it('keeps a genuinely flooding source tracked while one-shot spoofed keys are evicted', () => {
        const shedder = new AuthLoadShedder({
            shedThreshold: 3,
            shedWindowMs: 10_000,
            maxTrackedSources: 10,
            now: clock,
        });

        // The attacker's real source keeps failing; each spoofed key is used once and never again.
        for (let i = 0; i < 500; i += 1) {
            shedder.recordFailure('attacker');
            shedder.recordFailure(`spoof-${i}`);
        }

        expect(shedder.trackedSources()).toBeLessThanOrEqual(10);
        expect(shedder.shouldShed('attacker')).toBe(true);
    });

    it('bounds one source`s ring to the rolling window rather than to the request count', () => {
        const shedder = new AuthLoadShedder({ shedThreshold: 1_000_000, shedWindowMs: 1_000, now: clock });

        for (let i = 0; i < 5_000; i += 1) {
            now += 1; // 5,000 failures spread over 5 seconds — only the last second is live.
            shedder.recordFailure('one-source');
        }

        expect(shedder.trackedFailures('one-source')).toBeLessThanOrEqual(1_001);
    });

    it('evicts a source whose failures have all aged out, without waiting to be asked about it', () => {
        const shedder = new AuthLoadShedder({
            shedThreshold: 5,
            shedWindowMs: 1_000,
            maxTrackedSources: 10,
            now: clock,
        });
        shedder.recordFailure('quiet');

        now += 5_000;
        shedder.recordFailure('noisy');

        expect(shedder.trackedFailures('quiet')).toBe(0);
    });
});
