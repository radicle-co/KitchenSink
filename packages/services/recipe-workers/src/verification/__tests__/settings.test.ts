/**
 * The two SSM-backed settings the gate reads, and the caching around them (ADR-0024 §3).
 *
 * ⛔ WHY THESE ARE IN SSM AT ALL. R23 requires the ceiling be CONFIGURABLE, and ADR-0024 spells out the
 * consequence: "baking it into the function's environment would mean redeploying the worker stack to change
 * it mid-incident". The model id is there for the same reason — the bake-off's whole purpose is to change it.
 *
 * ⚠️ THE TTL IS A DELIBERATE DEPARTURE from the ADR's literal "read at Lambda cold start", and it serves the
 * ADR's own premise better than its mechanism. With `reservedConcurrency = 1` a container under a runaway
 * NEVER idles out, so a value memoised once per container is stalest exactly during the incident the
 * parameter exists to let an operator fix. A 60-second TTL costs one free standard-tier `GetParameters` per
 * container per minute and makes "lower the ceiling mid-incident" actually work. Flagged as an amendment
 * rather than shipped silently.
 */
import { describe, expect, it, vi } from 'vitest';

import { createVerificationSettings, isVerificationSettingsError, parseSettings } from '../settings.js';

const SETTINGS = { ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' };

describe('parseSettings', () => {
    it('reads a well-formed pair', () => {
        expect(parseSettings({ ceiling: '100000000', modelId: 'amazon.nova-micro-v1:0' })).toEqual(SETTINGS);
    });

    it.each([
        ['a non-numeric ceiling', { ceiling: 'one hundred dollars', modelId: 'amazon.nova-micro-v1:0' }],
        ['an empty ceiling', { ceiling: '', modelId: 'amazon.nova-micro-v1:0' }],
        ['a negative ceiling', { ceiling: '-1', modelId: 'amazon.nova-micro-v1:0' }],
        ['a fractional ceiling', { ceiling: '1.5', modelId: 'amazon.nova-micro-v1:0' }],
        ['an absent ceiling', { modelId: 'amazon.nova-micro-v1:0' }],
        ['an empty model id', { ceiling: '100000000', modelId: '' }],
        ['an absent model id', { ceiling: '100000000' }],
    ])('REFUSES %s rather than substituting a default', (_label, raw) => {
        // ⛔ NO DEFAULTS, in either direction. Defaulting the ceiling HIGH removes the gate; defaulting it LOW
        // denies every call. Defaulting the model id bills a model nobody selected and, worse, outlives the
        // parameter change that was meant to move it. A misconfigured stage must stop, loudly.
        expect(() => parseSettings(raw)).toThrow();
    });

    it('accepts a ZERO ceiling — that is a deliberate kill switch, not a misconfiguration', () => {
        // Setting the parameter to 0 makes the headroom negative for every call, so the gate denies
        // everything. That is the fastest brake an operator has mid-incident and it must not be refused as
        // invalid.
        expect(parseSettings({ ceiling: '0', modelId: 'amazon.nova-micro-v1:0' }).ceilingMicros).toBe(0);
    });
});

describe('createVerificationSettings', () => {
    it('reads once and reuses within the TTL', async () => {
        const load = vi.fn().mockResolvedValue(SETTINGS);
        let now = 1_000;
        const settings = createVerificationSettings({ load, ttlMs: 60_000, now: () => now });

        await settings.resolve();
        now += 59_000;
        await settings.resolve();

        expect(load).toHaveBeenCalledTimes(1);
    });

    it('re-reads after the TTL, so a lowered ceiling takes effect without a redeploy', async () => {
        const load = vi.fn().mockResolvedValue(SETTINGS);
        let now = 1_000;
        const settings = createVerificationSettings({ load, ttlMs: 60_000, now: () => now });

        await settings.resolve();
        now += 60_001;
        await settings.resolve();

        expect(load).toHaveBeenCalledTimes(2);
    });

    it('serves the NEW value after a refresh', async () => {
        const lowered = { ...SETTINGS, ceilingMicros: 1_000 };
        const load = vi.fn().mockResolvedValueOnce(SETTINGS).mockResolvedValue(lowered);
        let now = 1_000;
        const settings = createVerificationSettings({ load, ttlMs: 60_000, now: () => now });

        await settings.resolve();
        now += 60_001;

        expect((await settings.resolve()).ceilingMicros).toBe(1_000);
    });

    it('PROPAGATES a read failure — the gate fails closed', async () => {
        // ⛔ Without the ceiling and the model id there is no worst case to compute, so there is nothing to
        // reserve and the call cannot be made. The handler turns this into a message returned to the queue,
        // NOT into a line resolved as unresolved.
        const load = vi.fn().mockRejectedValue(new Error('ParameterNotFound'));
        const settings = createVerificationSettings({ load, ttlMs: 60_000, now: () => 1_000 });

        const error = await settings.resolve().catch((caught: unknown) => caught);

        expect(isVerificationSettingsError(error)).toBe(true);
    });

    it('does NOT cache a failure', async () => {
        // ⛔ A cached failure would poison the container for a whole TTL after a one-second SSM blip, turning
        // a transient fault into a minute of denied verification per container. Only successes are cached.
        const load = vi.fn().mockRejectedValueOnce(new Error('throttled')).mockResolvedValue(SETTINGS);
        const settings = createVerificationSettings({ load, ttlMs: 60_000, now: () => 1_000 });

        await settings.resolve().catch(() => undefined);

        expect((await settings.resolve()).modelId).toBe('amazon.nova-micro-v1:0');
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('shares ONE in-flight read across concurrent callers', async () => {
        // Single-flight. `reservedConcurrency = 1` makes this near-unreachable today, but the tier-4 rewrite
        // shares this module and the constant is explicitly allowed to change for throughput — at which point
        // a stampede on every TTL expiry would be N `GetParameters` calls for one value.
        let release: (value: typeof SETTINGS) => void = () => undefined;
        const load = vi.fn().mockReturnValue(
            new Promise<typeof SETTINGS>((resolve) => {
                release = resolve;
            }),
        );
        const settings = createVerificationSettings({ load, ttlMs: 60_000, now: () => 1_000 });

        const both = Promise.all([settings.resolve(), settings.resolve()]);
        release(SETTINGS);
        await both;

        expect(load).toHaveBeenCalledTimes(1);
    });
});
