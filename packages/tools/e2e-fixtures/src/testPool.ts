/**
 * The FIXED Clerk test pool: which users every test run signs in as, and which run gets which one.
 *
 * ## Why a fixed pool rather than a user per run (owner ruling 2026-09-13)
 *
 * > "We should have a pool of test users for clerk so that we don't need to create ones"
 *
 * Every tier used to MINT its users — web per shard, Maestro three per run, the linkage suite on demand — and
 * delete them afterwards. That made cleanup a Clerk delete, which is not data cleanup: a deleted Clerk user's
 * PUBLIC content survives, pseudonymised, and a crashed run's teardown never ran at all. With a fixed pool no
 * test creates a user, so what a run owes is resetting the DATA its slot authored — which `resetPool` does —
 * and the pool itself is provisioned by `poolAdmin` (the ONLY Clerk user-creation writer in test tooling): out of
 * band by the owner, except that the Maestro job tops the erasure subjects up through it before each run (owner
 * ruling 2026-10-08, which `poolAdmin.ts`'s header records).
 *
 * ## Allocation is by DECLARED ORDER, never by hash
 *
 * A slot is a (tier, lane) the roster below declares. A Playwright shard takes the lane at its index; k6 takes
 * the first N VU lanes. Nothing hashes a run onto a slot: `runFixtureIdentity.ts` records what two runs
 * addressing one user costs (bbf7ea7c), and a hash makes that collision a matter of chance. Two concurrent
 * runs of the SAME tier do share slots — that is what the workflow's `concurrency: test-pool-{tenant}-{tier}`
 * group serializes, which IS the lease (a Mutex GitHub already provides, so there is no lease table).
 *
 * ## ⛔ Membership is what makes a ticket safe to mint
 *
 * A sign-in ticket signs in WHOEVER it names, with the instance's secret key. `assertPoolMember` is therefore
 * the gate `establishSession` applies before minting one: an address that is not on this committed roster is
 * refused, which is stricter than the `+clerk_test` check it replaced (any other test user on the shared
 * instance passed that).
 *
 * ⚠️ THE SANDBOX TENANT ONLY. There is no production roster here on purpose. The containment policy that keeps a
 * prod slot's writes away from real users' data is decided and built (ADR-0040), but adding the production tenant
 * is a later step with its own sign-off (ADR-0040 ruling 5). `POOL_TENANTS` makes a prod slot unrepresentable until
 * then. (Owner answer, 2026-09-13, for that tenant: prod addresses are `testpool-{slot}@testpool.commise.app`, and
 * there is NO prod `food:admin` slot.)
 *
 * @pattern Registry — the roster, a typed `Record` over the tier union, so a tier nobody declared is a compile error
 * @pattern Allocator — a slot is its index in declared order, the shape `listenerPriority.ts` uses for ALB rules
 */
import type { Role } from '@kitchensink/clerk-verify';

/** The Clerk tenants a pool exists for. Sandbox only until the production tenant is signed off (ADR-0040 ruling 5). */
export const POOL_TENANTS = ['sandbox'] as const;

/** One of {@link POOL_TENANTS}. */
export type PoolTenant = (typeof POOL_TENANTS)[number];

/**
 * The tiers that lease slots, in declared order.
 *
 * `web` is the deployed Playwright matrix; `webStub` is the stubbed-API Playwright matrix. They are separate
 * tiers — not one tier's lanes shared — because both run on the same pull request at the same moment, and a `web`
 * lane is a LEASE: its concurrency group says one run holds that user, and `resetPool` purges the user's data
 * around the run. A stub run signing in on the same lane would hold the user outside that lease.
 *
 * ⚠️ `webStub` itself holds NO lease (no concurrency group — one would cancel pull requests' runs against each
 * other), so two pull requests' stub runs can sign in as the same lane at once. That is safe on two invariants,
 * and a change that breaks either needs a lease first:
 *
 *   1. **Every session a stub-tier spec ends is its own browser context's.** The tier runs only the specs that stub
 *      the recipe API (`mockRecipeApi`); among the session-owning ones that is `accountDangerZone.spec.ts` and
 *      `mockupFidelity.spec.ts`, and they end sessions only through clerk-js in their own context. Nothing in the
 *      tier revokes a session by id, deletes or updates the pool user, or writes its `public_metadata` — and
 *      Clerk holds any number of concurrent sessions per user.
 *   2. **The tier writes nothing to any stage.** It configures no deployed origin and every `/api/v1/**` call is
 *      intercepted in the browser, so there is no data to share, and nothing to reset.
 *
 * What concurrent stub runs DO share is Clerk's per-user sign-in rate — a flake risk, not a correctness one.
 *
 * `roles` (plan `docs/plans/2026-10-14-009-feat-roles-and-paid-gate-plan.md` D12; owner ruling 2026-10-13) is one user
 * per role, for the paid-feature specs and flows: a DEFAULT user proves only the upsell (or nothing) shows, and a
 * premium / vip / superuser user proves the paid flow shows. It holds NO lease and gets NO reset, on the webStub
 * argument, and that makes three rules binding on every spec or flow that signs in as one of its users:
 *
 *   1. **Sign in and READ only.** Never save, publish, toggle a visibility or write anything a reset would owe. Any
 *      number of runs may hold one of these users at once.
 *   2. **This is a safety rule, not only a reset rule.** `rolesuperuser` holds every curator scope (its role implies
 *      them, `ROLE_SCOPES`), and containment is off on sandbox (ADR-0040): a write as it reaches GLOBAL data.
 *   3. **End only your own session**, as the webStub tier does.
 *
 * A change that needs a write as one of these users needs a lease and resets first.
 */
export const POOL_TIERS = ['web', 'webStub', 'maestro', 'k6', 'linkage', 'roles'] as const;

/** One of {@link POOL_TIERS}. */
export type PoolTier = (typeof POOL_TIERS)[number];

/** One lane a tier declares. */
export interface PoolLane {
    /** Unique across the WHOLE roster; the address and username are derived from it. Lowercase alphanumerics. */
    readonly id: string;
    /**
     * The roles written to signed `public_metadata.roles` (owner ruling 2026-10-13: `default` is written, never
     * inferred). They decide the paid features (`hasPaidFeatures`) and imply scopes (`ROLE_SCOPES`). REQUIRED, so a
     * lane cannot say nothing.
     */
    readonly roles: readonly Role[];
    /** Grants carried in signed `public_metadata.scopes`. */
    readonly scopes: readonly string[];
    /** Destroyed by the flow that uses it (a real erasure), so `poolAdmin` replenishes it. */
    readonly consumable: boolean;
    /** A flow TYPES a password for this user, so `poolAdmin` creates it with {@link POOL_PASSWORD}. */
    readonly signsInByPassword: boolean;
}

/** A leasable user: a lane, placed in its tier, with its derived identifiers. */
export interface PoolSlot extends PoolLane {
    readonly tier: PoolTier;
    readonly email: string;
    readonly username: string;
}

/** What `poolAdmin` writes to a slot's Clerk `public_metadata`, by merge-PATCH. */
export interface PoolSlotMetadata {
    readonly testPrincipal: true;
    readonly roles: readonly Role[];
    readonly permissions: readonly string[];
    readonly scopes: readonly string[];
}

/**
 * The password the web sign-in spec and the Maestro flows TYPE.
 *
 * ⚠️ Committed, and not a secret — it was already committed by both suites before the pool existed. Every slot
 * that carries it is a `+clerk_test` address on the DEVELOPMENT instance, verifies with the fixed dev code, and
 * owns only fixture data a reset removes. Slots nothing types a password for are created with a random one.
 */
export const POOL_PASSWORD = 'Commise-e2e-Test-9j2xQ!';

const lane = (id: string, overrides: Partial<Omit<PoolLane, 'id'>> = {}): PoolLane => ({
    id,
    roles: ['default'],
    scopes: [],
    consumable: false,
    signsInByPassword: false,
    ...overrides,
});

const numbered = (prefix: string, count: number, overrides: Partial<Omit<PoolLane, 'id'>>): readonly PoolLane[] =>
    Array.from({ length: count }, (_, index) => lane(`${prefix}${String(index + 1).padStart(2, '0')}`, overrides));

/**
 * The k6 VU lanes. Their ids are the addresses the sandbox pool users ALREADY hold
 * (`test-alfa+clerk_test@radcile.com`), so moving the roster here re-provisions nobody.
 */
const K6_VU_IDS = [
    'alfa',
    'bravo',
    'charlie',
    'delta',
    'echo',
    'foxtrot',
    'golf',
    'hotel',
    'india',
    'juliett',
    'kilo',
    'lima',
    'mike',
    'november',
    'oscar',
    'papa',
    'quebec',
    'romeo',
    'sierra',
    'tango',
] as const;

/** {@link K6_VU_IDS} as a set: what makes a k6 lane a VU is its id, never the grants it happens to carry. */
const K6_VU_ID_SET: ReadonlySet<string> = new Set(K6_VU_IDS);

/**
 * THE roster. Adding a slot is a commit here plus an owner run of `poolAdmin --apply`; no test creates a user (the
 * Maestro job's refill only recreates consumed erasure subjects — `poolAdmin.ts`).
 *
 * ⚠️ Lane ORDER is part of the contract: a shard is its index and k6 takes a prefix. Append; never reorder or
 * insert, or every later shard signs in as a different user than the one its data was reset for.
 */
export const POOL_ROSTER: Readonly<Record<PoolTier, readonly PoolLane[]>> = {
    web: numbered('web', 8, { signsInByPassword: true }),
    webStub: numbered('webstub', 6, { signsInByPassword: true }),
    maestro: [
        // The signer owns the PRIVATE recipes of the seeded world, which the recipe service admits only for a
        // premium caller.
        lane('signer', { roles: ['premium'], signsInByPassword: true }),
        lane('coauthor'),
        // Each real erasure destroys its subject for good (identity keeps it unresolvable), so the flow takes
        // the first erasure slot that still exists and `poolAdmin` replenishes the rest.
        ...numbered('erasure', 10, { consumable: true, signsInByPassword: true }),
        // ⛔ SHARD 2's OWN IDENTITIES — APPENDED, never inserted, so no consumable is renumbered. The Maestro
        // tier runs as a matrix (`_ci-heavy.yml`), and a shard is only safe because its signer and co-author
        // are nobody else's: the per-flow reset RECONCILES the signer's library to the run manifest and
        // `resetPool` hard-deletes every row the slot owns, so two shards on one signer would delete each
        // other's fixtures mid-flow and answer `423 ERASURE_IN_PROGRESS` while a purge is in flight.
        // `MAESTRO_PLATFORM_LANES` is the index; `maestroShardCapacity` is what bounds the matrix.
        lane('signer02', { roles: ['premium'], signsInByPassword: true }),
        lane('coauthor02'),
        // Shards 3 and 4 of Android, then iOS's own four shards, so the two platforms run side by side instead of
        // queueing on one lane's concurrency group (owner, 2026-10-13). Appended, for the reason above.
        lane('signer03', { roles: ['premium'], signsInByPassword: true }),
        lane('coauthor03'),
        lane('signer04', { roles: ['premium'], signsInByPassword: true }),
        lane('coauthor04'),
        lane('iossigner01', { roles: ['premium'], signsInByPassword: true }),
        lane('ioscoauthor01'),
        lane('iossigner02', { roles: ['premium'], signsInByPassword: true }),
        lane('ioscoauthor02'),
        lane('iossigner03', { roles: ['premium'], signsInByPassword: true }),
        lane('ioscoauthor03'),
        lane('iossigner04', { roles: ['premium'], signsInByPassword: true }),
        lane('ioscoauthor04'),
    ],
    k6: [
        // Premium so the load scenarios' writes can be PRIVATE — a public write is visible to real users.
        ...K6_VU_IDS.map((id) => lane(id, { roles: ['premium'] })),
        lane('admin', { scopes: ['food:admin'] }),
    ],
    // Also the identity the deployed catalog seeder signs in as: it writes only food, which is shared by design.
    // The curator grant is for the deployed cookbook import suite, which runs in the linkage job as this lane and
    // declares `imported_public` (ADR-0023).
    linkage: [lane('linkage', { scopes: ['recipes:write', 'foods:read', 'recipes:import:public'] })],
    // One user per role — read-only, no lease, no reset (the `POOL_TIERS` doc states the rules). Password sign-in,
    // because the Maestro flows type it.
    roles: [
        lane('roledefault', { roles: ['default'], signsInByPassword: true }),
        lane('roleadmin', { roles: ['admin'], signsInByPassword: true }),
        lane('rolepremium', { roles: ['premium'], signsInByPassword: true }),
        lane('rolesuperuser', { roles: ['superuser'], signsInByPassword: true }),
        lane('rolevip', { roles: ['vip'], signsInByPassword: true }),
    ],
};

/**
 * The `roles` tier's lane for each role — the ONE place a spec or flow names the user it signs in as for a role.
 * `testPool.test.ts` holds it equal to `POOL_ROSTER.roles`.
 */
export const ROLE_LANE_IDS: Readonly<Record<Role, string>> = {
    default: 'roledefault',
    admin: 'roleadmin',
    premium: 'rolepremium',
    superuser: 'rolesuperuser',
    vip: 'rolevip',
};

/**
 * The platforms the Maestro tier runs on. `runMaestroFlows.sh`'s `PLATFORMS` is the runner's own list, and its
 * default is `android`.
 */
export const MAESTRO_PLATFORMS = ['android', 'ios'] as const;

/** One of {@link MAESTRO_PLATFORMS}. */
export type MaestroPlatform = (typeof MAESTRO_PLATFORMS)[number];

/** Which identity of a Maestro shard is being asked for. */
export type MaestroShardRole = 'signer' | 'coauthor';

/**
 * The lanes one platform's Maestro matrix draws from, in shard order: shard `k` takes the signer and the co-author at
 * index `k - 1`, and the platform's own erasure subjects for {@link MAESTRO_ERASURE_SHARD}.
 */
interface MaestroPlatformLanes {
    readonly signer: readonly string[];
    readonly coauthor: readonly string[];
    readonly erasure: readonly string[];
}

/**
 * The Maestro tier's identities, PARTITIONED BY PLATFORM and then by shard (owner, 2026-10-13: "iOS gets its own
 * Clerk pool lanes"). It replaces the single per-shard list both platforms shared, which made them queue on one
 * concurrency group per shard and the iOS run wait for the Android one.
 *
 * ⚠️ Android shard 1 keeps the ORIGINAL ids (`signer`, `coauthor`) on purpose — their Clerk users already exist, so an
 * unsharded or Android-only run addresses byte-identical slots. The iOS lanes and Android shards 3-4 are APPENDED to
 * {@link POOL_ROSTER}; adding a shard is an append there plus an owner run of `poolAdmin --apply`.
 *
 * ⛔ Each platform's three lists are NOT the same length by obligation; signer and co-author are, because a shard needs
 * BOTH and {@link maestroShardCapacity} takes the minimum, so a half-declared shard is unrepresentable rather than a
 * run that leases one identity and fails on the other. The erasure set is Android `erasure01-05`, iOS `erasure06-10`:
 * the ten consumable users are split in half, one half per platform, and no new erasure user exists.
 *
 * The type is a `Record` over the platform union, so a platform added to {@link MAESTRO_PLATFORMS} without lanes is a
 * compile error. This module must not know about workflows; the workflow's side of the contract is held by
 * `maestroShardPartition.test.ts`.
 */
const MAESTRO_PLATFORM_LANES: Readonly<Record<MaestroPlatform, MaestroPlatformLanes>> = {
    android: {
        signer: ['signer', 'signer02', 'signer03', 'signer04'],
        coauthor: ['coauthor', 'coauthor02', 'coauthor03', 'coauthor04'],
        erasure: ['erasure01', 'erasure02', 'erasure03', 'erasure04', 'erasure05'],
    },
    ios: {
        signer: ['iossigner01', 'iossigner02', 'iossigner03', 'iossigner04'],
        coauthor: ['ioscoauthor01', 'ioscoauthor02', 'ioscoauthor03', 'ioscoauthor04'],
        erasure: ['erasure06', 'erasure07', 'erasure08', 'erasure09', 'erasure10'],
    },
};

/** The lanes of a platform; throws for a platform the roster does not declare (a cast can smuggle one in). Pure. */
function lanesFor(platform: MaestroPlatform): MaestroPlatformLanes {
    // `Object.hasOwn`, not `in`: a platform named `toString` or `constructor` must not resolve to an inherited member.
    if (!Object.hasOwn(MAESTRO_PLATFORM_LANES, platform)) {
        throw new Error(
            `test pool: '${String(platform)}' is not a Maestro platform — the roster declares ${MAESTRO_PLATFORMS.join(', ')}`,
        );
    }

    return MAESTRO_PLATFORM_LANES[platform];
}

/**
 * How many Maestro shards one platform's lanes can give DISJOINT identities to. Pure.
 *
 * Bounded by the scarcer of the two identities EVERY shard needs — a signer and a co-author. The erasure subjects
 * do not bound it: they all belong to {@link MAESTRO_ERASURE_SHARD}, so no other shard needs one.
 * `runMaestroFlows.sh`'s `MAESTRO_MAX_SHARDS` is the shell-side copy of this number, and
 * `maestroShardPartition.test.ts` asserts the two agree from disk (neither language can typecheck the other).
 *
 * @param platform - `android` or `ios`.
 */
export function maestroShardCapacity(platform: MaestroPlatform): number {
    const lanes = lanesFor(platform);

    return Math.min(lanes.signer.length, lanes.coauthor.length);
}

/**
 * The slot a 1-based Maestro shard of one platform signs in as, for one role. Pure.
 *
 * ⛔ It THROWS past the declared lanes rather than wrapping, for the reason {@link slotForShard} records: a
 * wrap would put two shards of one run on one user — the collision the pool exists to rule out — and would
 * do it silently, as data loss rather than as an error.
 *
 * @param role - `signer` or `coauthor`.
 * @param platform - `android` or `ios`.
 * @param shard - The 1-based shard index.
 * @returns That shard's slot for the role.
 */
export function maestroSlotForShard(role: MaestroShardRole, platform: MaestroPlatform, shard: number): PoolSlot {
    const declaredLanes = lanesFor(platform)[role];

    if (!Number.isInteger(shard) || shard < 1) {
        throw new Error(`test pool: a Maestro shard must be a positive integer, got ${String(shard)}`);
    }

    const declared = declaredLanes[shard - 1];

    if (declared === undefined) {
        throw new Error(
            `test pool: ${platform} Maestro shard ${shard} has no '${role}' lane — the roster declares only ` +
                `${declaredLanes.length}. Append lanes to POOL_ROSTER, run poolAdmin --apply, ` +
                'then raise the `maestro_shards` input.',
        );
    }

    return slotFor('maestro', declared);
}

/**
 * The ONE Maestro shard of each platform that erases. `runMaestroFlows.sh`'s `MAESTRO_ERASURE_SHARD` is the
 * shell-side copy, which pins every erasing flow here, and `maestroShardPartition.test.ts` asserts the two agree from
 * disk.
 *
 * ⛔ It is shard 1 because shard 1 is the only index EVERY matrix holds — the `'[1]'` fallback, a narrowed
 * selection, and a platform whose exclusions leave it fewer shards than the other. Pinning to "the last shard"
 * would not do: each platform's matrix is sized separately, so one run's two platforms could then erase on
 * two different lanes at once.
 */
export const MAESTRO_ERASURE_SHARD = 1;

/**
 * The erasure subjects a 1-based Maestro shard of one platform may lease, in declared order: that platform's
 * own subjects for {@link MAESTRO_ERASURE_SHARD}, and none for any other shard. Pure.
 *
 * ## The lease contract (2026-10-08 stride -> one lane; 2026-10-13 one lane PER PLATFORM)
 *
 * The stride split the ten subjects across the shards, which was safe but wasted half of them: the flow plan always
 * packed `accountErasure` onto shard 2, so shard 1's five were leased and never erased while shard 2's five ran dry.
 * Then one shard of the matrix held all ten. Now each PLATFORM's shard 1 holds five of them (Android `erasure01-05`,
 * iOS `erasure06-10`) and the runner pins every erasing flow to it, so what keeps two runs off one subject is the LANE
 * that shard leases, not a partition of the slots:
 *
 *   - only a platform's erasure shard leases a subject, refills the subjects, or runs an erasing flow;
 *   - in CI its concurrency group (`test-pool-sandbox-maestro-1` for Android, `test-pool-sandbox-maestro-ios-1` for
 *     iOS; a group name is repository-wide) admits one job at a time, across every run of every caller;
 *   - the two platforms' subjects are DISJOINT, so an Android job and an iOS job never contend for one;
 *   - so at any moment at most one CI job per platform can lease, refill or erase, and `firstAvailableSlot` taking the
 *     first subject still standing cannot collide with another. A run cancelled mid-flow has either erased its
 *     subject (gone; the next holder's refill recreates it) or not (standing; the next holder may take it) — both
 *     are safe.
 *
 * ⚠️ Hazards this does NOT close. Each can only fail a run — every candidate is a consumable subject that owns
 * nothing, so none can erase the wrong KIND of account:
 *
 *   - **A local run holds no lane.** `local-sandbox`'s `localMaestro.sh` runs as Android shard 1 against the same
 *     sandbox Clerk instance and leases from the same five, so a local run concurrent with a CI Android lane-1 job can
 *     lease the same subject, and one of the two erasures fails.
 *   - **A run of OLDER code on another branch.** The previous workflow gave every platform's shard 1 all ten subjects
 *     and one shared group, so an old-code Android shard 1 can draw `erasure06-10` while a new iOS shard 1 holds them.
 *     It clears as branches pick up this change.
 *   - **Erasure is asynchronous** (identity, the deletion queue, the worker, then Clerk), so a subject a cancelled
 *     run had started erasing can still exist when the next holder leases it, and be deleted under that holder's
 *     flow. That predates the lane, and the refill does not buffer it: it recreates the first subject, which the
 *     next lease takes again.
 *
 * @param platform - `android` or `ios`.
 * @param shard - The 1-based shard index.
 * @returns That platform's consumable maestro slots for the erasure shard; empty for every other shard.
 */
export function maestroErasureSlots(platform: MaestroPlatform, shard: number): readonly PoolSlot[] {
    const lanes = lanesFor(platform);

    if (!Number.isInteger(shard) || shard < 1) {
        throw new Error(`test pool: a Maestro shard must be a positive integer, got ${String(shard)}`);
    }

    return shard === MAESTRO_ERASURE_SHARD ? lanes.erasure.map((id) => slotFor('maestro', id)) : [];
}

/** The sandbox tenant's address for a slot id. The `+clerk_test` subaddress is what makes it a Clerk test user. */
const ADDRESS: Readonly<Record<PoolTenant, (id: string) => string>> = {
    sandbox: (id) => `test-${id}+clerk_test@radcile.com`,
};

/** Place a lane in its tier and derive its identifiers. Pure. */
function toSlot(tier: PoolTier, declared: PoolLane): PoolSlot {
    const email = ADDRESS.sandbox(declared.id);

    return {
        ...declared,
        tier,
        email,
        // The address's local part with every non-alphanumeric run collapsed to `_` — ONE input for both
        // identifiers Clerk holds unique, so they cannot drift apart.
        username: email.slice(0, email.indexOf('@')).replace(/[^a-z0-9]+/gu, '_'),
    };
}

/** Every slot, in declared order (tier order, then lane order). Pure. */
export function rosterSlots(): readonly PoolSlot[] {
    return POOL_TIERS.flatMap((tier) => POOL_ROSTER[tier].map((declared) => toSlot(tier, declared)));
}

/** The slot a tier declares under `id`; throws for a lane that tier does not declare. Pure. */
export function slotFor(tier: PoolTier, id: string): PoolSlot {
    const declared = POOL_ROSTER[tier].find((candidate) => candidate.id === id);

    if (declared === undefined) {
        throw new Error(`test pool: tier '${tier}' declares no lane '${id}'`);
    }

    return toSlot(tier, declared);
}

/**
 * The slot a 1-based Playwright shard leases: the lane at index `shard - 1`. Pure.
 *
 * ⛔ It THROWS past the declared lanes rather than wrapping. Wrapping would put two shards of one run on one
 * user — the collision the whole pool exists to rule out — and it would do so silently.
 */
export function slotForShard(tier: 'web' | 'webStub', shard: number): PoolSlot {
    if (!Number.isInteger(shard) || shard < 1) {
        throw new Error(`test pool: shard must be a positive integer, got ${String(shard)}`);
    }

    const declared = POOL_ROSTER[tier][shard - 1];

    if (declared === undefined) {
        throw new Error(
            `test pool: shard ${shard} has no slot — tier '${tier}' declares only ${POOL_ROSTER[tier].length}. ` +
                'Append lanes to POOL_ROSTER and run poolAdmin, or shrink the matrix.',
        );
    }

    return toSlot(tier, declared);
}

/**
 * The VU lanes among a k6 roster, in declared order. Pure.
 *
 * Selected by id from {@link K6_VU_IDS}. Selecting by "carries no scope" once stood here, and it silently dropped any
 * VU lane later given a grant while admitting any grantless lane that is not a VU.
 *
 * @param lanes - The k6 tier's declared lanes.
 * @returns The lanes whose id is a declared VU id.
 */
export function k6VuLanes(lanes: readonly PoolLane[]): readonly PoolLane[] {
    return lanes.filter((declared) => K6_VU_ID_SET.has(declared.id));
}

/** The first `count` k6 VU slots, in declared order — never the admin. Pure. */
export function k6VuSlots(count: number): readonly PoolSlot[] {
    const vus = k6VuLanes(POOL_ROSTER.k6);

    if (!Number.isInteger(count) || count < 1) {
        throw new Error(`test pool: k6 needs at least one VU slot, got ${String(count)}`);
    }

    if (count > vus.length) {
        throw new Error(`test pool: ${count} k6 VUs requested, but the roster declares only ${vus.length}`);
    }

    return vus.slice(0, count).map((declared) => toSlot('k6', declared));
}

/** A tier's consumable slots, in declared order. Pure. */
export function consumableSlots(tier: PoolTier): readonly PoolSlot[] {
    return POOL_ROSTER[tier].filter((declared) => declared.consumable).map((declared) => toSlot(tier, declared));
}

/**
 * Refuse any address that is not on the roster. Pure.
 *
 * Exact match after lowercasing only — no trimming, no subaddress folding — because every leniency is a way for
 * an address that is not a pool user to be admitted.
 */
export function assertPoolMember(email: string): void {
    const address = email.toLowerCase();

    if (!rosterSlots().some((slot) => slot.email === address)) {
        throw new Error(`${email} is not a member of the test pool — only POOL_ROSTER addresses are signed into`);
    }
}

/**
 * The `public_metadata` a slot must carry. Pure.
 *
 * Every list is stated, empty included: `poolAdmin` writes it with Clerk's merge-PATCH, which replaces arrays
 * wholesale, so an empty list is what revokes a grant the roster no longer declares. `roles` is written on EVERY slot,
 * so the identity webhook's sign-up writer (which merges `default` only where no `roles` key exists) never touches one.
 */
export function poolSlotMetadata(slot: PoolLane): PoolSlotMetadata {
    return {
        testPrincipal: true,
        roles: [...slot.roles],
        // ⛔ Always EMPTY: premium is a role now, and the old `premium` permission grants nothing. Stating the list is
        // what makes the merge-PATCH revoke it from a user that still carries it.
        permissions: [],
        scopes: [...slot.scopes],
    };
}
