/**
 * The fixed Clerk test pool's roster and allocator.
 *
 * These are the properties every run that leases a slot depends on, asserted where they can fail:
 *
 *   - the roster is TOTAL over the tier union (a tier nobody declared is a compile error, asserted again here
 *     at runtime so a cast cannot smuggle an empty tier through);
 *   - slot ids, addresses and usernames are DISJOINT, because Clerk enforces both unique per instance and two
 *     slots sharing either would be two runs addressing one user — `runFixtureIdentity.ts`'s bbf7ea7c incident;
 *   - allocation is by DECLARED ORDER, never by hashing a run onto a slot, so the same (tier, lane) always
 *     names the same user and no two lanes can collide by chance;
 *   - membership is the ONLY thing that lets a ticket be minted, so a real person's account can never be
 *     signed into by the tooling.
 */
import { describe, expect, it } from 'vitest';

import {
    assertPoolMember,
    consumableSlots,
    k6VuLanes,
    k6VuSlots,
    maestroConsumableSlots,
    maestroShardCapacity,
    maestroSlotForShard,
    POOL_PASSWORD,
    POOL_ROSTER,
    POOL_TIERS,
    poolSlotMetadata,
    rosterSlots,
    slotFor,
    slotForShard,
    type PoolLane,
} from '../src/testPool.js';

describe('the roster', () => {
    it('declares at least one slot for every tier in the union', () => {
        for (const tier of POOL_TIERS) {
            expect(POOL_ROSTER[tier].length, `${tier} declares no slot`).toBeGreaterThan(0);
        }
    });

    it('gives every slot a distinct id, address and username across the WHOLE roster', () => {
        const slots = rosterSlots();
        const distinct = (values: readonly string[]): number => new Set(values.map((v) => v.toLowerCase())).size;

        expect(distinct(slots.map((slot) => slot.id))).toBe(slots.length);
        expect(distinct(slots.map((slot) => slot.email))).toBe(slots.length);
        expect(distinct(slots.map((slot) => slot.username))).toBe(slots.length);
    });

    it('lists slots in declared order: tier order first, then lane order within a tier', () => {
        const expected = POOL_TIERS.flatMap((tier) => POOL_ROSTER[tier].map((lane) => `${tier}/${lane.id}`));

        expect(rosterSlots().map((slot) => `${slot.tier}/${slot.id}`)).toEqual(expected);
    });

    it('addresses every sandbox slot as a Clerk TEST address, so the dev instance sends no mail', () => {
        for (const slot of rosterSlots()) {
            expect(slot.email).toMatch(/^test-[a-z0-9]+\+clerk_test@radcile\.com$/u);
        }
    });

    it('derives the username from the same id as the address, so the two cannot drift apart', () => {
        // Measured, run 34017385400: an address that moved while its username stayed put collided on
        // `form_identifier_exists / username` with the previous pool's users.
        for (const slot of rosterSlots()) {
            expect(slot.username).toBe(`test_${slot.id}_clerk_test`);
        }
    });

    it('keeps the k6 addresses the existing sandbox pool users already hold', () => {
        // Re-addressing them would orphan twenty-one live users on the shared dev instance and force a
        // re-provision for no gain.
        expect(slotFor('k6', 'alfa').email).toBe('test-alfa+clerk_test@radcile.com');
        expect(slotFor('k6', 'admin').email).toBe('test-admin+clerk_test@radcile.com');
        expect(slotFor('k6', 'alfa').username).toBe('test_alfa_clerk_test');
    });
});

describe('slotFor', () => {
    it('returns the declared slot for a (tier, lane)', () => {
        expect(slotFor('maestro', 'signer')).toMatchObject({ tier: 'maestro', id: 'signer' });
    });

    it('refuses a lane the tier does not declare, rather than inventing a user', () => {
        expect(() => slotFor('maestro', 'nobody')).toThrow(/maestro.*nobody/u);
        // A lane declared by ANOTHER tier is not this tier's to lease.
        expect(() => slotFor('web', 'signer')).toThrow(/web.*signer/u);
    });
});

describe('slotForShard', () => {
    it('allocates a Playwright shard to the lane at its declared index — shard N is lane N', () => {
        const web = POOL_ROSTER.web;

        for (let shard = 1; shard <= web.length; shard += 1) {
            expect(slotForShard('web', shard).id).toBe(web[shard - 1]?.id);
        }
    });

    it('is stable: the same shard names the same user on every call', () => {
        expect(slotForShard('webStub', 3)).toEqual(slotForShard('webStub', 3));
    });

    it('gives different shards different users, within a tier and across the two web tiers', () => {
        expect(slotForShard('web', 1).email).not.toBe(slotForShard('web', 2).email);
        expect(slotForShard('web', 1).email).not.toBe(slotForShard('webStub', 1).email);
    });

    it.each([0, -1, 1.5, Number.NaN])('refuses shard %s', (shard) => {
        expect(() => slotForShard('web', shard)).toThrow(/shard/u);
    });

    it('refuses a shard beyond the declared lanes — the matrix outgrew the pool', () => {
        expect(() => slotForShard('web', POOL_ROSTER.web.length + 1)).toThrow(/declares only/u);
    });

    it('covers the two Playwright matrices as they are wired today (8 deployed shards, 6 stubbed)', () => {
        expect(POOL_ROSTER.web.length).toBeGreaterThanOrEqual(8);
        expect(POOL_ROSTER.webStub.length).toBeGreaterThanOrEqual(6);
    });
});

describe('k6VuLanes', () => {
    const lane = (id: string, scopes: readonly string[]): PoolLane => ({
        id,
        premium: true,
        scopes,
        consumable: false,
        signsInByPassword: false,
    });

    it('selects a VU lane by its id, so a VU given a grant is still a VU and a grantless non-VU is not', () => {
        const roster = [
            lane('alfa', ['recipes:write']),
            lane('admin', ['food:admin']),
            lane('bravo', []),
            lane('zulu', []),
        ];

        expect(k6VuLanes(roster).map((declared) => declared.id)).toEqual(['alfa', 'bravo']);
    });
});

describe('k6VuSlots', () => {
    it('takes the first N VU lanes in declared order and never the admin', () => {
        const slots = k6VuSlots(3);

        expect(slots.map((slot) => slot.id)).toEqual(['alfa', 'bravo', 'charlie']);
        expect(k6VuSlots(20).some((slot) => slot.id === 'admin')).toBe(false);
    });

    it('selects through k6VuLanes, so every VU the roster declares is a slot and nothing else is', () => {
        expect(k6VuSlots(20).map((slot) => slot.id)).toEqual(k6VuLanes(POOL_ROSTER.k6).map((declared) => declared.id));
        expect(k6VuLanes(POOL_ROSTER.k6)).toHaveLength(20);
    });

    it('refuses more VUs than the pool declares, and a non-positive count', () => {
        expect(() => k6VuSlots(21)).toThrow(/declares only 20/u);
        expect(() => k6VuSlots(0)).toThrow(/at least one/u);
    });
});

describe('consumableSlots', () => {
    it('are the maestro erasure subjects, in declared order, and nothing else', () => {
        const slots = consumableSlots('maestro');

        expect(slots.length).toBeGreaterThanOrEqual(10);
        expect(slots.every((slot) => slot.consumable && slot.id.startsWith('erasure'))).toBe(true);
        expect(rosterSlots().filter((slot) => slot.consumable)).toEqual(slots);
    });

    it('never makes a slot another tier signs in as consumable', () => {
        expect(consumableSlots('k6')).toEqual([]);
        expect(consumableSlots('web')).toEqual([]);
    });
});

describe('assertPoolMember', () => {
    it('admits every roster address, case-insensitively', () => {
        for (const slot of rosterSlots()) {
            expect(() => assertPoolMember(slot.email)).not.toThrow();
            expect(() => assertPoolMember(slot.email.toUpperCase())).not.toThrow();
        }
    });

    it.each([
        'someone@example.com',
        // A test address is NOT enough: it could be any other test user on the shared instance.
        'commise-e2e-signin+clerk_test@example.com',
        // Near-misses of a real slot.
        'test-alfa@radcile.com',
        'test-alfa+clerk_test@radcile.com.evil.test',
        ' test-alfa+clerk_test@radcile.com',
    ])('refuses %s', (email) => {
        expect(() => assertPoolMember(email)).toThrow(/not a member of the test pool/u);
    });
});

describe('poolSlotMetadata', () => {
    it('marks every slot as a test principal', () => {
        for (const slot of rosterSlots()) {
            expect(poolSlotMetadata(slot).testPrincipal).toBe(true);
        }
    });

    it('grants premium exactly where the roster declares it, and only as the premium permission', () => {
        expect(poolSlotMetadata(slotFor('k6', 'alfa')).permissions).toEqual(['premium']);
        expect(poolSlotMetadata(slotFor('maestro', 'signer')).permissions).toEqual(['premium']);
        // A non-premium slot states an EMPTY list, so a merge-PATCH revokes a stale grant instead of keeping it.
        expect(poolSlotMetadata(slotFor('maestro', 'coauthor')).permissions).toEqual([]);
    });

    it('carries the scopes the roster declares, and no scope on a VU', () => {
        expect(poolSlotMetadata(slotFor('k6', 'admin')).scopes).toEqual(['food:admin']);
        expect(poolSlotMetadata(slotFor('linkage', 'linkage')).scopes).toEqual(['recipes:write', 'foods:read']);
        expect(poolSlotMetadata(slotFor('k6', 'alfa')).scopes).toEqual([]);
    });

    it('grants food:admin to exactly one slot in the whole roster', () => {
        const admins = rosterSlots().filter((slot) => poolSlotMetadata(slot).scopes.includes('food:admin'));

        expect(admins.map((slot) => slot.id)).toEqual(['admin']);
    });
});

describe('password-bearing slots', () => {
    /**
     * ⛔ REWRITTEN for Maestro sharding, and DERIVED rather than listed. It used to name `maestro/signer`
     * literally, which made "the tier now has a signer per shard" look like a defect in the roster instead of
     * the change it is. Every shard's signer types the password on its own device, so the claim is per-SHARD;
     * comparing sorted sets rather than the roster's declaration order keeps the assertion about WHICH slots
     * type a password, which is what `poolAdmin` acts on, and leaves lane order to the tests that own it.
     */
    it('are exactly the slots a flow types a password for: the web shards, every maestro signer, every erasure', () => {
        const typed = rosterSlots()
            .filter((slot) => slot.signsInByPassword)
            .map((slot) => `${slot.tier}/${slot.id}`);
        const signers = Array.from({ length: maestroShardCapacity() }, (_, index) =>
            maestroSlotForShard('signer', index + 1),
        );

        expect([...typed].sort()).toEqual(
            [
                ...POOL_ROSTER.web.map((lane) => `web/${lane.id}`),
                ...POOL_ROSTER.webStub.map((lane) => `webStub/${lane.id}`),
                ...signers.map((slot) => `maestro/${slot.id}`),
                ...consumableSlots('maestro').map((slot) => `maestro/${slot.id}`),
            ].sort(),
        );
    });

    it('⛔ gives EVERY shard’s signer the password, because every shard types it on its own device', () => {
        for (let shard = 1; shard <= maestroShardCapacity(); shard += 1) {
            expect(maestroSlotForShard('signer', shard).signsInByPassword, `shard ${shard}`).toBe(true);
            // The co-author is an API identity only — `provision` signs it in over HTTP and no flow types it.
            expect(maestroSlotForShard('coauthor', shard).signsInByPassword, `shard ${shard}`).toBe(false);
        }
    });

    it('⛔ gives EVERY shard’s signer `premium`, or its three PRIVATE seeded recipes are refused', () => {
        for (let shard = 1; shard <= maestroShardCapacity(); shard += 1) {
            expect(poolSlotMetadata(maestroSlotForShard('signer', shard)).permissions, `shard ${shard}`).toEqual([
                'premium',
            ]);
        }
    });

    it('share the one password the flows type', () => {
        expect(POOL_PASSWORD).toBe('Commise-e2e-Test-9j2xQ!');
    });
});

/**
 * The Maestro tier runs as a matrix, and a shard is only safe because its identities are nobody else's: the
 * per-flow reset RECONCILES the signer's library to the run manifest and `resetPool` hard-deletes every row a
 * slot owns, so two shards on one signer delete each other's fixtures mid-flow and answer `423
 * ERASURE_IN_PROGRESS` while a purge runs. These are the allocator's side of that argument;
 * `packages/infra/global/__tests__/maestroShardPartition.test.ts` owns the workflow's side.
 */
describe('maestro shard allocation', () => {
    it('reaches exactly as far as the SCARCEST identity a shard needs', () => {
        expect(maestroShardCapacity()).toBe(
            Math.min(
                POOL_ROSTER.maestro.filter((lane) => lane.id.startsWith('signer')).length,
                POOL_ROSTER.maestro.filter((lane) => lane.id.startsWith('coauthor')).length,
                consumableSlots('maestro').length,
            ),
        );
    });

    it('⛔ never hands two shards the same identity', () => {
        const capacity = maestroShardCapacity();
        const emails = Array.from({ length: capacity }, (_, index) => index + 1).flatMap((shard) => [
            maestroSlotForShard('signer', shard).email,
            maestroSlotForShard('coauthor', shard).email,
            ...maestroConsumableSlots(shard, capacity).map((slot) => slot.email),
        ]);

        expect(new Set(emails).size).toBe(emails.length);
    });

    it('⛔ THROWS past the roster rather than wrapping onto shard 1, and says how to fix it', () => {
        const past = maestroShardCapacity() + 1;

        expect(() => maestroSlotForShard('signer', past)).toThrow(/poolAdmin --apply/u);
        expect(() => maestroSlotForShard('coauthor', past)).toThrow(/poolAdmin --apply/u);
    });

    it('refuses a shard index that is not a positive integer', () => {
        for (const shard of [0, -1, 1.5, Number.NaN]) {
            expect(() => maestroSlotForShard('signer', shard), String(shard)).toThrow(/positive integer/u);
            expect(() => maestroConsumableSlots(shard, 2), String(shard)).toThrow(/positive integers/u);
        }
    });

    it('keeps shard 1 on the ids Clerk already holds, so sharding re-provisions nobody', () => {
        expect(maestroSlotForShard('signer', 1)).toEqual(slotFor('maestro', 'signer'));
        expect(maestroSlotForShard('coauthor', 1)).toEqual(slotFor('maestro', 'coauthor'));
    });

    /**
     * ⛔ A STRIDE, NOT A SLICE, and this is the case that distinguishes them. `firstAvailableSlot` skips a
     * CONSUMED slot, so "skip the first k, then take the first available" collapses both shards onto the same
     * next-surviving subject the moment an early slot has been erased — and a shared erasure subject is one
     * shard really erasing the account the other has just leased.
     */
    it('partitions the consumables, losing none and inventing none', () => {
        for (const count of [1, 2, 3, 4]) {
            const strides = Array.from({ length: count }, (_, index) =>
                maestroConsumableSlots(index + 1, count).map((slot) => slot.id),
            );

            expect(strides.flat().sort()).toEqual(
                consumableSlots('maestro')
                    .map((slot) => slot.id)
                    .sort(),
            );
            // Disjoint, and every shard inside capacity gets at least one to lease.
            expect(new Set(strides.flat()).size).toBe(strides.flat().length);

            for (let shard = 1; shard <= Math.min(count, maestroShardCapacity()); shard += 1) {
                expect(strides[shard - 1]?.length, `shard ${shard}/${count}`).toBeGreaterThan(0);
            }
        }
    });
});
