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
    MAESTRO_ERASURE_SHARD,
    MAESTRO_PLATFORMS,
    maestroErasureSlots,
    maestroShardCapacity,
    maestroSlotForShard,
    POOL_PASSWORD,
    POOL_ROSTER,
    POOL_TIERS,
    poolSlotMetadata,
    ROLE_LANE_IDS,
    rosterSlots,
    slotFor,
    slotForShard,
    type MaestroPlatform,
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
        roles: ['premium'],
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

    /**
     * REWRITTEN 2026-10-14 (plan 2026-10-14-009 D12): premium is a ROLE now (`public_metadata.roles`, owner ruling
     * 2026-10-13), and the old `premium` permission grants nothing — so every slot states `permissions: []`, which
     * is what makes `poolAdmin`'s merge-PATCH revoke the old grant from the users that still carry it.
     */
    it('grants premium exactly where the roster declares it, as the premium ROLE, and revokes the old permission', () => {
        expect(poolSlotMetadata(slotFor('k6', 'alfa')).roles).toEqual(['premium']);
        expect(poolSlotMetadata(slotFor('maestro', 'signer')).roles).toEqual(['premium']);
        expect(poolSlotMetadata(slotFor('maestro', 'coauthor')).roles).toEqual(['default']);

        for (const slot of rosterSlots()) {
            expect(poolSlotMetadata(slot).permissions, slot.id).toEqual([]);
        }
    });

    /** `default` is WRITTEN, never inferred from absence (owner ruling 2026-10-13), the pool included. */
    it('states a role on every slot', () => {
        for (const slot of rosterSlots()) {
            expect(poolSlotMetadata(slot).roles.length, slot.id).toBeGreaterThan(0);
        }
    });

    /**
     * REWRITTEN 2026-10-03: the linkage lane also carries the curator grant (ADR-0023), because the deployed cookbook
     * import suite runs in the linkage job, on that job's lease, as that lane.
     */
    it('carries the scopes the roster declares, and no scope on a VU', () => {
        expect(poolSlotMetadata(slotFor('k6', 'admin')).scopes).toEqual(['food:admin']);
        expect(poolSlotMetadata(slotFor('linkage', 'linkage')).scopes).toEqual([
            'recipes:write',
            'foods:read',
            'recipes:import:public',
        ]);
        expect(poolSlotMetadata(slotFor('k6', 'alfa')).scopes).toEqual([]);
    });

    it.each([
        ['food:admin', 'k6/admin'],
        ['recipes:import:public', 'linkage/linkage'],
    ])('grants %s to exactly one slot in the whole roster', (scope, holder) => {
        const holders = rosterSlots().filter((slot) => poolSlotMetadata(slot).scopes.includes(scope));

        expect(holders.map((slot) => `${slot.tier}/${slot.id}`)).toEqual([holder]);
    });
});

/** Every (platform, 1-based shard) the roster can serve, in platform order. */
const everyShard = (): readonly { readonly platform: MaestroPlatform; readonly shard: number }[] =>
    MAESTRO_PLATFORMS.flatMap((platform) =>
        Array.from({ length: maestroShardCapacity(platform) }, (_, index) => ({ platform, shard: index + 1 })),
    );

describe('password-bearing slots', () => {
    /**
     * REWRITTEN for per-platform lanes (2026-10-13), and still DERIVED rather than listed: every shard's signer, on
     * EITHER platform, types the password on its own device, so the claim is per (platform, shard). Comparing sorted
     * sets keeps the assertion about WHICH slots type a password, which is what `poolAdmin` acts on.
     */
    it('are exactly the slots a flow types a password for: web shards, maestro signers, erasures and the role users', () => {
        const typed = rosterSlots()
            .filter((slot) => slot.signsInByPassword)
            .map((slot) => `${slot.tier}/${slot.id}`);
        const signers = everyShard().map(({ platform, shard }) => maestroSlotForShard('signer', platform, shard));

        expect([...typed].sort()).toEqual(
            [
                ...POOL_ROSTER.web.map((lane) => `web/${lane.id}`),
                ...POOL_ROSTER.webStub.map((lane) => `webStub/${lane.id}`),
                ...signers.map((slot) => `maestro/${slot.id}`),
                ...consumableSlots('maestro').map((slot) => `maestro/${slot.id}`),
                ...POOL_ROSTER.roles.map((lane) => `roles/${lane.id}`),
            ].sort(),
        );
    });

    it('⛔ gives EVERY shard’s signer the password, on both platforms, because every shard types it on its own device', () => {
        for (const { platform, shard } of everyShard()) {
            const label = `${platform} shard ${shard}`;

            expect(maestroSlotForShard('signer', platform, shard).signsInByPassword, label).toBe(true);
            // The co-author is an API identity only — `provision` signs it in over HTTP and no flow types it.
            expect(maestroSlotForShard('coauthor', platform, shard).signsInByPassword, label).toBe(false);
        }
    });

    it('⛔ gives EVERY shard’s signer `premium`, or its three PRIVATE seeded recipes are refused', () => {
        for (const { platform, shard } of everyShard()) {
            expect(
                poolSlotMetadata(maestroSlotForShard('signer', platform, shard)).roles,
                `${platform} shard ${shard}`,
            ).toEqual(['premium']);
        }
    });

    it('share the one password the flows type', () => {
        expect(POOL_PASSWORD).toBe('Commise-e2e-Test-9j2xQ!');
    });
});

/**
 * The Maestro tier runs as a matrix per platform, and a shard is only safe because its identities are nobody else's:
 * the per-flow reset RECONCILES the signer's library to the run manifest and `resetPool` hard-deletes every row a
 * slot owns, so two shards on one signer delete each other's fixtures mid-flow and answer `423
 * ERASURE_IN_PROGRESS` while a purge runs. These are the allocator's side of that argument;
 * `packages/infra/global/__tests__/maestroShardPartition.test.ts` owns the workflow's side.
 *
 * REWRITTEN 2026-10-13: the lanes are now partitioned by (platform, shard). Android and iOS each have four, so the
 * two platforms run side by side instead of queueing on one lane's concurrency group.
 */
describe('maestro shard allocation', () => {
    it('declares exactly the two platforms the runner knows', () => {
        expect(MAESTRO_PLATFORMS).toEqual(['android', 'ios']);
    });

    it('gives each platform four shards, which is the shell runner’s own maximum', () => {
        for (const platform of MAESTRO_PLATFORMS) {
            expect(maestroShardCapacity(platform), platform).toBe(4);
        }
    });

    /**
     * Capacity is the scarcer of the two identities every shard needs, per platform: it is read off the roster
     * itself, so a lane appended without its partner moves neither number.
     */
    it('reaches exactly as far as the scarcer of the two identities every shard needs', () => {
        const declared = (prefix: string): number =>
            POOL_ROSTER.maestro.filter((lane) => new RegExp(`^${prefix}\\d*$`, 'u').test(lane.id)).length;

        expect(maestroShardCapacity('android')).toBe(Math.min(declared('signer'), declared('coauthor')));
        expect(maestroShardCapacity('ios')).toBe(Math.min(declared('iossigner'), declared('ioscoauthor')));
    });

    it('⛔ never hands two shards, on either platform, the same identity — erasure subjects included', () => {
        const emails = everyShard().flatMap(({ platform, shard }) => [
            maestroSlotForShard('signer', platform, shard).email,
            maestroSlotForShard('coauthor', platform, shard).email,
            ...maestroErasureSlots(platform, shard).map((slot) => slot.email),
        ]);

        expect(emails).toHaveLength(4 * 2 * 2 + 10);
        expect(new Set(emails).size).toBe(emails.length);
    });

    it('declares every one of the eight lanes in the roster, and no other maestro signer or co-author', () => {
        const lanes = everyShard().flatMap(({ platform, shard }) => [
            maestroSlotForShard('signer', platform, shard).id,
            maestroSlotForShard('coauthor', platform, shard).id,
        ]);
        const rostered = POOL_ROSTER.maestro.filter((lane) => !lane.consumable).map((lane) => lane.id);

        expect([...lanes].sort()).toEqual([...rostered].sort());
    });

    it('⛔ THROWS past the roster rather than wrapping onto shard 1, and says how to fix it', () => {
        for (const platform of MAESTRO_PLATFORMS) {
            const past = maestroShardCapacity(platform) + 1;

            expect(() => maestroSlotForShard('signer', platform, past)).toThrow(/poolAdmin --apply/u);
            expect(() => maestroSlotForShard('coauthor', platform, past)).toThrow(/poolAdmin --apply/u);
        }
    });

    it('refuses a shard index that is not a positive integer', () => {
        for (const platform of MAESTRO_PLATFORMS) {
            for (const shard of [0, -1, 1.5, Number.NaN]) {
                expect(() => maestroSlotForShard('signer', platform, shard), String(shard)).toThrow(
                    /positive integer/u,
                );
                expect(() => maestroErasureSlots(platform, shard), String(shard)).toThrow(/positive integer/u);
            }
        }
    });

    it('⛔ refuses a platform the roster does not declare, rather than inventing lanes for it', () => {
        const unknown = 'windows' as unknown as MaestroPlatform;

        expect(() => maestroShardCapacity(unknown)).toThrow(/platform/u);
        expect(() => maestroSlotForShard('signer', unknown, 1)).toThrow(/platform/u);
        expect(() => maestroErasureSlots(unknown, 1)).toThrow(/platform/u);
    });

    it('keeps Android shard 1 on the ids Clerk already holds, so the split re-provisions nobody', () => {
        expect(maestroSlotForShard('signer', 'android', 1)).toEqual(slotFor('maestro', 'signer'));
        expect(maestroSlotForShard('coauthor', 'android', 1)).toEqual(slotFor('maestro', 'coauthor'));
    });

    it('gives iOS lanes of its own: iossigner01..04 and ioscoauthor01..04, in shard order', () => {
        expect(Array.from({ length: 4 }, (_, i) => maestroSlotForShard('signer', 'ios', i + 1).id)).toEqual([
            'iossigner01',
            'iossigner02',
            'iossigner03',
            'iossigner04',
        ]);
        expect(Array.from({ length: 4 }, (_, i) => maestroSlotForShard('coauthor', 'ios', i + 1).id)).toEqual([
            'ioscoauthor01',
            'ioscoauthor02',
            'ioscoauthor03',
            'ioscoauthor04',
        ]);
    });

    it('keeps Android shards 2 to 4 on signer02..04 and coauthor02..04', () => {
        expect(Array.from({ length: 3 }, (_, i) => maestroSlotForShard('signer', 'android', i + 2).id)).toEqual([
            'signer02',
            'signer03',
            'signer04',
        ]);
        expect(Array.from({ length: 3 }, (_, i) => maestroSlotForShard('coauthor', 'android', i + 2).id)).toEqual([
            'coauthor02',
            'coauthor03',
            'coauthor04',
        ]);
    });

    it('⛔ APPENDS the new lanes: the maestro roster before them keeps its old order, so no shard changes user', () => {
        expect(POOL_ROSTER.maestro.slice(0, 14).map((lane) => lane.id)).toEqual([
            'signer',
            'coauthor',
            ...Array.from({ length: 10 }, (_, i) => `erasure${String(i + 1).padStart(2, '0')}`),
            'signer02',
            'coauthor02',
        ]);
    });
});

/**
 * THE ERASURE LANE, per platform (2026-10-13; it refines the 2026-10-08 lane, which was one lane for both platforms).
 * Each platform's shard 1 leases ITS OWN five subjects: Android `erasure01-05`, iOS `erasure06-10`. The runner still
 * pins every erasing flow to shard 1 of its platform, and that shard's concurrency group admits one job at a time, so
 * one job per platform can lease, and the two platforms draw from DISJOINT sets and cannot collide with each other.
 */
describe('maestro erasure lane', () => {
    const ids = (platform: MaestroPlatform): readonly string[] =>
        maestroErasureSlots(platform, MAESTRO_ERASURE_SHARD).map((slot) => slot.id);

    it('is shard 1 — the only index every matrix holds, the `[1]` fallback included', () => {
        expect(MAESTRO_ERASURE_SHARD).toBe(1);
    });

    it('gives Android shard 1 erasure01-05 and iOS shard 1 erasure06-10, in declared order', () => {
        expect(ids('android')).toEqual(['erasure01', 'erasure02', 'erasure03', 'erasure04', 'erasure05']);
        expect(ids('ios')).toEqual(['erasure06', 'erasure07', 'erasure08', 'erasure09', 'erasure10']);
    });

    it('⛔ keeps the two platforms’ sets disjoint, and their union is every consumable subject', () => {
        const android = ids('android');
        const ios = ids('ios');

        expect(android.filter((id) => ios.includes(id))).toEqual([]);
        expect([...android, ...ios]).toEqual(consumableSlots('maestro').map((slot) => slot.id));
    });

    it('⛔ gives every OTHER shard none on either platform — a second eraser would sit on another lane', () => {
        for (const platform of MAESTRO_PLATFORMS) {
            for (let shard = 1; shard <= maestroShardCapacity(platform) + 2; shard += 1) {
                if (shard !== MAESTRO_ERASURE_SHARD) {
                    expect(maestroErasureSlots(platform, shard), `${platform} shard ${shard}`).toEqual([]);
                }
            }
        }
    });

    it('needs at least one subject per platform, or the erasure story could never run', () => {
        for (const platform of MAESTRO_PLATFORMS) {
            expect(ids(platform).length, platform).toBeGreaterThan(0);
        }
    });
});

/**
 * The `roles` tier (plan 2026-10-14-009 D12; owner ruling 2026-10-13): one user per role, so a paid-feature test can
 * sign in as a DEFAULT user to prove only the upsell (or nothing) shows, and as premium / vip / superuser to prove the
 * paid flow shows.
 */
describe('the roles tier', () => {
    it('declares exactly one lane per role, each carrying that role', () => {
        expect(POOL_ROSTER.roles.map((lane) => [lane.id, lane.roles])).toStrictEqual([
            ['roledefault', ['default']],
            ['roleadmin', ['admin']],
            ['rolepremium', ['premium']],
            ['rolesuperuser', ['superuser']],
            ['rolevip', ['vip']],
        ]);
    });

    it('names its lanes once, for the specs and flows that sign in as them', () => {
        expect(ROLE_LANE_IDS).toStrictEqual({
            default: 'roledefault',
            admin: 'roleadmin',
            premium: 'rolepremium',
            superuser: 'rolesuperuser',
            vip: 'rolevip',
        });

        for (const id of Object.values(ROLE_LANE_IDS)) {
            expect(slotFor('roles', id).roles).toHaveLength(1);
        }
    });

    it('signs in by password (the Maestro flows type it), holds no scope and is never consumed', () => {
        for (const lane of POOL_ROSTER.roles) {
            expect(lane.signsInByPassword, lane.id).toBe(true);
            expect(lane.scopes, lane.id).toEqual([]);
            expect(lane.consumable, lane.id).toBe(false);
        }
    });

    it('is the LAST tier, so no existing lane is renumbered', () => {
        expect(POOL_TIERS.at(-1)).toBe('roles');
    });
});
