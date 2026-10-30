/**
 * The pool slots a lane aligns are the ones THAT lane's platform signs in. `alignIdentities.ts` used to hard-code
 * `android`, so an iOS lane's users were never aligned: the app then read a fresh local id for its own `sub`, and the
 * services (which take the owner from Clerk's `external_id`) disagreed with it about who owns a recipe.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { poolSlotMetadata, type PoolSlot } from '@kitchensink/e2e-fixtures/testPool';

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
            syncUsername: () => Promise.reject(new Error('unreachable')),
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

// The recycled-user cases run in the local namespace, whose addresses they assert.
afterAll(() => {
    vi.unstubAllEnvs();
});

describe('a recycled pool user, whose address an older local row still holds', () => {
    /**
     * A local run deletes its erasure subjects from Clerk and makes new ones under the SAME address. The local identity
     * keeps the old user's row, and email is unique among active rows, so provisioning the new user fell back to a
     * placeholder address and the app showed `user_…@no-email.invalid` where the flow expects the subject's email.
     */
    beforeAll(() => {
        vi.stubEnv('E2E_POOL_NAMESPACE', 'local');
    });
    const slot = (): PoolSlot | undefined =>
        alignmentSlots({ platform: 'android', shard: 1 }).find((candidate) => candidate.id === 'erasure01');

    const run = async (withPort: boolean) => {
        const calls: string[] = [];
        const user = {
            id: 'user_new',
            externalId: '01NEWNEWNEWNEWNEWNEWNEWNEW',
            emailAddresses: [],
            publicMetadata: {
                testPrincipal: true,
                ...(slot() === undefined ? {} : poolSlotMetadata(slot() as PoolSlot)),
            },
        };

        await alignPoolIdentities(slot() === undefined ? [] : [slot() as PoolSlot], {
            findUsers: () => Promise.resolve([user as never]),
            rowsFor: () => Promise.resolve([]),
            removeRow: () => Promise.resolve(),
            syncUsername: () => Promise.resolve(),
            ...(withPort
                ? {
                      removeStaleRowsForEmail: (email: string, keep: string) => {
                          calls.push(`stale ${email} keep ${keep}`);

                          return Promise.resolve();
                      },
                  }
                : {}),
            provision: ({ externalId }) => {
                calls.push('provision');

                return Promise.resolve(externalId);
            },
        }).catch((error: unknown) => {
            calls.push(`refused ${String(error)}`);
        });

        return calls;
    };

    it('clears the stale rows of that address before provisioning, keeping the user being aligned', async () => {
        expect((await run(true)).slice(0, 2)).toEqual([
            'stale test-local-erasure01+clerk_test@radcile.com keep user_new',
            'provision',
        ]);
    });

    it('does nothing of the kind when the port is not given (the shared pool)', async () => {
        expect(await run(false)).toEqual(['provision']);
    });
});

describe('the local role users', () => {
    /**
     * `paidFeaturesByRole` and `makePublicConfirm` sign in as the `roles` tier, whose Clerk users exist locally only when
     * the owner has room for them (`poolAdmin --local-roles`, opt-in). They are aligned only when the run asked for
     * them, so a lane without them neither looks up six more users nor changes the slots it always aligned.
     */
    it('are not aligned unless the lane asks for them', () => {
        expect(laneFromEnv({})).toEqual({ platform: 'android', shard: 1 });
        expect(ids('android', 1)).not.toContain('roledefault');
    });

    it('are asked for by LOCAL_MAESTRO_ROLE_USERS=1, exactly', () => {
        expect(laneFromEnv({ LOCAL_MAESTRO_ROLE_USERS: '1' })).toEqual({ platform: 'android', shard: 1, roles: true });
        expect(laneFromEnv({ LOCAL_MAESTRO_ROLE_USERS: '0' }).roles).toBeUndefined();
        expect(laneFromEnv({ LOCAL_MAESTRO_ROLE_USERS: '' }).roles).toBeUndefined();
    });

    it('add the whole roles tier after the lane slots', () => {
        const slots = alignmentSlots({ platform: 'android', shard: 2, roles: true }).map((slot) => slot.id);

        expect(slots.slice(0, 2)).toEqual(['signer02', 'coauthor02']);
        expect(slots).toEqual(
            expect.arrayContaining(['roledefault', 'roleadmin', 'rolepremium', 'rolesuperuser', 'rolevip']),
        );
    });
});
