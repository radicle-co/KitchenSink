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

/**
 * The bucket key is the address the TRUSTED proxy chain observed, counted from the right of `X-Forwarded-For` (security
 * review F8). Each trusted proxy APPENDS the address it saw, so the rightmost `trustedProxyHops` entries are written by
 * our own infrastructure and everything to their left is whatever the client sent. Rewritten from "prefers the
 * leftmost hop", which keyed the shedder on the one entry the client controls.
 */
describe('AuthLoadShedder — source key: the address the trusted proxy chain observed (F8)', () => {
    it('counts one trusted hop from the right behind the ALB alone (sandbox, pr-{N})', () => {
        const shedder = new AuthLoadShedder({ trustedProxyHops: 1 });

        expect(shedder.sourceKey({ xForwardedFor: '6.6.6.6, 203.0.113.7', ip: '10.0.0.9' })).toBe('203.0.113.7');
    });

    it('counts two trusted hops from the right behind CloudFront and the ALB (prod)', () => {
        const shedder = new AuthLoadShedder({ trustedProxyHops: 2 });

        expect(shedder.sourceKey({ xForwardedFor: '6.6.6.6, 203.0.113.7, 130.176.1.1', ip: '10.0.0.9' })).toBe(
            '203.0.113.7',
        );
    });

    // ⛔ The property F8 exists for. A client that rewrites the header on every request must still land in ONE bucket.
    it('gives one client one bucket however it spoofs the entries to the left', () => {
        const shedder = new AuthLoadShedder({ trustedProxyHops: 1 });
        const keys = ['1.1.1.1, 203.0.113.7', '2.2.2.2, 3.3.3.3, 203.0.113.7', '203.0.113.7'].map((xForwardedFor) =>
            shedder.sourceKey({ xForwardedFor, ip: '10.0.0.9' }),
        );

        expect(new Set(keys)).toEqual(new Set(['203.0.113.7']));
    });

    it('reads no header at all with no trusted proxy, so a developer machine keys on the socket', () => {
        const shedder = new AuthLoadShedder({ trustedProxyHops: 0 });

        expect(shedder.sourceKey({ xForwardedFor: '6.6.6.6', ip: '127.0.0.1' })).toBe('127.0.0.1');
    });

    it('trusts no proxy by default', () => {
        expect(new AuthLoadShedder().sourceKey({ xForwardedFor: '6.6.6.6', ip: '127.0.0.1' })).toBe('127.0.0.1');
    });

    // A chain shorter than the hop count holds only entries trusted proxies appended, so its leftmost entry is the
    // furthest address the chain saw. This is Express's `trust proxy` rule for a hop count.
    it('takes the leftmost entry when the chain is shorter than the hop count', () => {
        const shedder = new AuthLoadShedder({ trustedProxyHops: 2 });

        expect(shedder.sourceKey({ xForwardedFor: '203.0.113.7', ip: '10.0.0.9' })).toBe('203.0.113.7');
    });

    it('skips empty entries, which no proxy writes', () => {
        const shedder = new AuthLoadShedder({ trustedProxyHops: 1 });

        expect(shedder.sourceKey({ xForwardedFor: '6.6.6.6, , 203.0.113.7 ,', ip: '10.0.0.9' })).toBe('203.0.113.7');
    });

    it('falls back to the socket address when a proxied request carries no usable header', () => {
        const shedder = new AuthLoadShedder({ trustedProxyHops: 1 });

        expect(shedder.sourceKey({ xForwardedFor: undefined, ip: '10.0.0.9' })).toBe('10.0.0.9');
        expect(shedder.sourceKey({ xForwardedFor: ' , ', ip: '10.0.0.9' })).toBe('10.0.0.9');
    });

    it("answers 'unknown' when nothing identifies the source", () => {
        expect(
            new AuthLoadShedder({ trustedProxyHops: 1 }).sourceKey({ xForwardedFor: undefined, ip: undefined }),
        ).toBe('unknown');
    });
});

describe('AuthLoadShedder — bounded source tracking (finding 02.F-F1 / 08.F-SEC1)', () => {
    let now: number;
    const clock = (): number => now;

    beforeEach(() => {
        now = 1_000_000;
    });

    /**
     * The bucket key no longer comes from an entry the client writes (F8), but the bound still matters: a client
     * with many real addresses (a botnet, an IPv6 range) still mints a fresh key per request, and a task with a
     * wrong hop count keys on client-written entries again. Without a bound the defence against a DoS is itself
     * the DoS: one Map entry per request, forever, until the task is OOM-killed.
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
