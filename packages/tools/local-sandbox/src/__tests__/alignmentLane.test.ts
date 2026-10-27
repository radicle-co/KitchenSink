/**
 * The pool slots a lane aligns are the ones THAT lane's platform signs in. `alignIdentities.ts` used to hard-code
 * `android`, so an iOS lane's users were never aligned: the app then read a fresh local id for its own `sub`, and the
 * services (which take the owner from Clerk's `external_id`) disagreed with it about who owns a recipe.
 */
import { describe, expect, it } from 'vitest';

import { alignmentSlots, laneFromEnv } from '../alignmentLane.js';
import { alignPoolIdentities } from '../identityAlignment.js';

const ids = (platform: 'android' | 'ios', shard: number): readonly string[] =>
    alignmentSlots({ platform, shard }).map((slot) => slot.id);

describe('laneFromEnv', () => {
    it('defaults to android shard 1, so `local:maestro` keeps its behaviour', () => {
        expect(laneFromEnv({})).toEqual({ platform: 'android', shard: 1 });
    });

    it('reads the platform and the shard from the lane environment', () => {
        expect(laneFromEnv({ MAESTRO_PLATFORM: 'ios', COMMISE_E2E_SHARD: '2' })).toEqual({ platform: 'ios', shard: 2 });
    });

    it('treats empty values as absent', () => {
        expect(laneFromEnv({ MAESTRO_PLATFORM: '', COMMISE_E2E_SHARD: '' })).toEqual({ platform: 'android', shard: 1 });
    });

    it.each(['tvos', 'IOS', 'android ', 'constructor'])('refuses the platform %j', (platform) => {
        expect(() => laneFromEnv({ MAESTRO_PLATFORM: platform })).toThrow(/MAESTRO_PLATFORM/u);
    });

    it.each(['0', '-1', '1.5', 'two'])('refuses the shard %j', (shard) => {
        expect(() => laneFromEnv({ COMMISE_E2E_SHARD: shard })).toThrow(/COMMISE_E2E_SHARD/u);
    });
});

describe('alignmentSlots', () => {
    it("aligns android shard 1's signer, co-author and five erasure subjects", () => {
        expect(ids('android', 1)).toEqual([
            'signer',
            'coauthor',
            'erasure01',
            'erasure02',
            'erasure03',
            'erasure04',
            'erasure05',
        ]);
    });

    it("aligns ios shard 1's own lanes, never android's", () => {
        expect(ids('ios', 1)).toEqual([
            'iossigner01',
            'ioscoauthor01',
            'erasure06',
            'erasure07',
            'erasure08',
            'erasure09',
            'erasure10',
        ]);
    });

    it('gives a shard that does not erase no erasure subject', () => {
        expect(ids('ios', 2)).toEqual(['iossigner02', 'ioscoauthor02']);
        expect(ids('android', 2)).toEqual(['signer02', 'coauthor02']);
    });
});

describe('a lane, through the alignment itself', () => {
    it("looks up an iOS lane's own users in Clerk, and no Android one", async () => {
        const asked: string[] = [];

        await alignPoolIdentities(alignmentSlots(laneFromEnv({ MAESTRO_PLATFORM: 'ios', COMMISE_E2E_SHARD: '1' })), {
            // Nobody holds the address: an `absent` outcome, so no database port is reached.
            findUsers: (email) => {
                asked.push(email);

                return Promise.resolve([]);
            },
            rowsFor: () => Promise.reject(new Error('unreachable')),
            removeRow: () => Promise.reject(new Error('unreachable')),
            provision: () => Promise.reject(new Error('unreachable')),
        });

        expect(asked).toEqual([
            'test-iossigner01+clerk_test@radcile.com',
            'test-ioscoauthor01+clerk_test@radcile.com',
            ...['06', '07', '08', '09', '10'].map((n) => `test-erasure${n}+clerk_test@radcile.com`),
        ]);
    });
});
