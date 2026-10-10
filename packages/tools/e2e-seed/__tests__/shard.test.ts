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

import { assertShardsAgree, resolveShard } from '../src/shard.js';

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
