/**
 * Which shard a seed process belongs to, and the refusal that keeps two channels for that one fact from
 * drifting apart.
 *
 * ## What is actually at stake here
 *
 * Every assertion below is about a DESTRUCTIVE outcome, not a cosmetic one. `provision` leases its identities
 * from `COMMISE_E2E_SHARD` and `resetPool` purges its slots from `--shard`; if those two ever named different
 * shards, one step of one job would hard-delete the world a CONCURRENT job was mid-flow in. So the failure
 * these cases pin is not "wrong number" — it is "shard 2's job emptied shard 1's library".
 *
 * ⚠️ Mutation lens: making `resolveShard` fall back to 1 on an unreadable value reds the refusal case (and is
 * exactly the silent demotion that would put two shards on one signer); making `assertShardsAgree` compare
 * with `==` after a `Number` coercion, or skip when either side is absent, reds the disagreement cases.
 */
import { describe, expect, it } from 'vitest';

import { assertPlatformsAgree, assertShardsAgree, resolveMaestroPlatform, resolveShard } from '../src/shard.js';

describe('resolveShard', () => {
    it('reads the shard the matrix stated', () => {
        expect(resolveShard({ COMMISE_E2E_SHARD: '2' })).toBe(2);
        expect(resolveShard({ COMMISE_E2E_SHARD: '10' })).toBe(10);
    });

    it('is shard 1 when nothing says otherwise — the unsharded tier, not a guess', () => {
        expect(resolveShard({})).toBe(1);
        expect(resolveShard({ COMMISE_E2E_SHARD: '' })).toBe(1);
        expect(resolveShard({ COMMISE_E2E_SHARD: undefined })).toBe(1);
    });

    it('⛔ REFUSES a present-but-unreadable shard rather than demoting it to 1', () => {
        // A demotion here is not a smaller number, it is two shards signing in as one user.
        for (const raw of ['0', '-1', '1.5', 'two', ' 2', '2x', 'NaN', 'Infinity']) {
            expect(() => resolveShard({ COMMISE_E2E_SHARD: raw }), raw).toThrow(/positive integer/u);
        }
    });
});

describe('assertShardsAgree', () => {
    it('passes when the two channels name the same shard', () => {
        expect(() => assertShardsAgree(2, { COMMISE_E2E_SHARD: '2' })).not.toThrow();
        expect(() => assertShardsAgree(1, { COMMISE_E2E_SHARD: '1' })).not.toThrow();
    });

    it('passes when only the command line states a shard — a local run sets no environment', () => {
        expect(() => assertShardsAgree(1, {})).not.toThrow();
        expect(() => assertShardsAgree(3, { COMMISE_E2E_SHARD: '' })).not.toThrow();
    });

    it('⛔ REFUSES a disagreement, and names both sides so the workflow is what gets fixed', () => {
        expect(() => assertShardsAgree(1, { COMMISE_E2E_SHARD: '2' })).toThrow(/--shard 1 contradicts/u);
        expect(() => assertShardsAgree(2, { COMMISE_E2E_SHARD: '1' })).toThrow(/COMMISE_E2E_SHARD=1/u);
    });

    it('⛔ never picks a winner — the message says to fix the workflow, not which side is right', () => {
        expect(() => assertShardsAgree(1, { COMMISE_E2E_SHARD: '2' })).toThrow(/do not pick a winner/u);
    });

    it('propagates an unreadable environment shard rather than treating it as absent', () => {
        expect(() => assertShardsAgree(1, { COMMISE_E2E_SHARD: 'nope' })).toThrow(/positive integer/u);
    });
});

/**
 * The PLATFORM is the second axis of the lane a Maestro process belongs to (2026-10-13: iOS has pool lanes of its
 * own). It is carried on two channels for the same reason the shard is, and it is just as destructive to get wrong:
 * a job that leased the iOS signer while resetting the Android one would purge the world of a run still in flight.
 *
 * ⚠️ Mutation lens: defaulting an UNKNOWN value to `android` reds the refusal case (and would put an iOS job on the
 * Android lane); skipping the comparison when either side is absent reds nothing here on purpose — a local run sets
 * no environment — but comparing with a coercion reds the disagreement cases.
 */
describe('resolveMaestroPlatform', () => {
    it('reads the platform the job stated', () => {
        expect(resolveMaestroPlatform({ MAESTRO_PLATFORM: 'ios' })).toBe('ios');
        expect(resolveMaestroPlatform({ MAESTRO_PLATFORM: 'android' })).toBe('android');
    });

    it('is android when nothing says otherwise — the runner’s own default, not a guess', () => {
        expect(resolveMaestroPlatform({})).toBe('android');
        expect(resolveMaestroPlatform({ MAESTRO_PLATFORM: '' })).toBe('android');
        expect(resolveMaestroPlatform({ MAESTRO_PLATFORM: undefined })).toBe('android');
    });

    it('⛔ REFUSES a present-but-unknown platform rather than demoting it to android', () => {
        for (const raw of ['windows', 'iOS', 'IOS', ' ios', 'ios ', 'android,ios', 'both', 'null']) {
            expect(() => resolveMaestroPlatform({ MAESTRO_PLATFORM: raw }), raw).toThrow(/MAESTRO_PLATFORM/u);
        }
    });
});

describe('assertPlatformsAgree', () => {
    it('passes when the two channels name the same platform', () => {
        expect(() => assertPlatformsAgree('ios', { MAESTRO_PLATFORM: 'ios' })).not.toThrow();
        expect(() => assertPlatformsAgree('android', { MAESTRO_PLATFORM: 'android' })).not.toThrow();
    });

    it('passes when only the command line states a platform — a local run sets no environment', () => {
        expect(() => assertPlatformsAgree('ios', {})).not.toThrow();
        expect(() => assertPlatformsAgree('android', { MAESTRO_PLATFORM: '' })).not.toThrow();
    });

    it('⛔ REFUSES a disagreement, names both sides, and does not pick a winner', () => {
        expect(() => assertPlatformsAgree('android', { MAESTRO_PLATFORM: 'ios' })).toThrow(
            /--platform android contradicts/u,
        );
        expect(() => assertPlatformsAgree('ios', { MAESTRO_PLATFORM: 'android' })).toThrow(/MAESTRO_PLATFORM=android/u);
        expect(() => assertPlatformsAgree('ios', { MAESTRO_PLATFORM: 'android' })).toThrow(/do not pick a winner/u);
    });

    it('propagates an unreadable environment platform rather than treating it as absent', () => {
        expect(() => assertPlatformsAgree('ios', { MAESTRO_PLATFORM: 'nope' })).toThrow(/MAESTRO_PLATFORM/u);
    });
});
