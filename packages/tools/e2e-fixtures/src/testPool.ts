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
 * run creates a user, so what a run owes is resetting the DATA its slot authored — which `resetPool` does —
 * and the pool itself is provisioned once, out of band, by `poolAdmin` (the ONLY Clerk user-creation writer
 * in test tooling).
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
 */
export const POOL_TIERS = ['web', 'webStub', 'maestro', 'k6', 'linkage'] as const;

/** One of {@link POOL_TIERS}. */
export type PoolTier = (typeof POOL_TIERS)[number];

/** One lane a tier declares. */
export interface PoolLane {
    /** Unique across the WHOLE roster; the address and username are derived from it. Lowercase alphanumerics. */
    readonly id: string;
    /** Carries the `premium` permission the recipe service reads from signed `public_metadata`. */
    readonly premium: boolean;
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
    premium: false,
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
 * THE roster. Adding a slot is a commit here plus an owner run of `poolAdmin --apply`; nothing creates a user
 * at test time.
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
        lane('signer', { premium: true, signsInByPassword: true }),
        lane('coauthor'),
        // Each real erasure destroys its subject for good (identity keeps it unresolvable), so the flow takes
        // the first erasure slot that still exists and `poolAdmin` replenishes the rest.
        ...numbered('erasure', 10, { consumable: true, signsInByPassword: true }),
        // ⛔ SHARD 2's OWN IDENTITIES — APPENDED, never inserted, so no consumable is renumbered. The Maestro
        // tier runs as a matrix (`_ci-heavy.yml`), and a shard is only safe because its signer and co-author
        // are nobody else's: the per-flow reset RECONCILES the signer's library to the run manifest and
        // `resetPool` hard-deletes every row the slot owns, so two shards on one signer would delete each
        // other's fixtures mid-flow and answer `423 ERASURE_IN_PROGRESS` while a purge is in flight.
        // `MAESTRO_SHARD_LANES` is the index; `maestroShardCapacity` is what bounds the matrix.
        lane('signer02', { premium: true, signsInByPassword: true }),
        lane('coauthor02'),
    ],
    k6: [
        // Premium so the load scenarios' writes can be PRIVATE — a public write is visible to real users.
        ...K6_VU_IDS.map((id) => lane(id, { premium: true })),
        lane('admin', { scopes: ['food:admin'] }),
    ],
    // Also the identity the deployed catalog seeder signs in as: it writes only food, which is shared by design.
    linkage: [lane('linkage', { scopes: ['recipes:write', 'foods:read'] })],
};

/**
 * The Maestro tier's per-SHARD identities, in shard order: shard `k` takes the lane at index `k - 1`.
 *
 * ⚠️ Shard 1 keeps the ORIGINAL ids (`signer`, `coauthor`) on purpose — their Clerk users already exist, so
 * sharding re-provisions nobody and an unsharded run addresses byte-identical slots. Adding a shard is an
 * append here plus an owner run of `poolAdmin --apply`; nothing creates a user at test time.
 *
 * ⛔ The two lists are the same length BY OBLIGATION, not by accident: a shard needs BOTH a signer and a
 * co-author, and {@link maestroShardCapacity} takes the minimum so a half-declared shard is unrepresentable
 * rather than a run that leases one identity and fails on the other.
 */
const MAESTRO_SHARD_LANES = {
    signer: ['signer', 'signer02'],
    coauthor: ['coauthor', 'coauthor02'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** Which identity of a Maestro shard is being asked for. */
export type MaestroShardRole = keyof typeof MAESTRO_SHARD_LANES;

/**
 * How many Maestro shards the roster can give DISJOINT identities to. Pure.
 *
 * Bounded by the SCARCEST of the three a shard needs — a signer, a co-author and at least one consumable
 * erasure subject — never by one of them. `runMaestroFlows.sh`'s `MAESTRO_MAX_SHARDS` is the shell-side copy
 * of this number, and `maestroShardPartition.test.ts` asserts the two agree from disk (neither language can
 * typecheck the other).
 */
export function maestroShardCapacity(): number {
    return Math.min(
        MAESTRO_SHARD_LANES.signer.length,
        MAESTRO_SHARD_LANES.coauthor.length,
        consumableSlots('maestro').length,
    );
}

/**
 * The slot a 1-based Maestro shard signs in as, for one role. Pure.
 *
 * ⛔ It THROWS past the declared lanes rather than wrapping, for the reason {@link slotForShard} records: a
 * wrap would put two shards of one run on one user — the collision the pool exists to rule out — and would
 * do it silently, as data loss rather than as an error.
 *
 * @param role - `signer` or `coauthor`.
 * @param shard - The 1-based shard index.
 * @returns That shard's slot for the role.
 */
export function maestroSlotForShard(role: MaestroShardRole, shard: number): PoolSlot {
    if (!Number.isInteger(shard) || shard < 1) {
        throw new Error(`test pool: a Maestro shard must be a positive integer, got ${String(shard)}`);
    }

    const declared = MAESTRO_SHARD_LANES[role][shard - 1];

    if (declared === undefined) {
        throw new Error(
            `test pool: Maestro shard ${shard} has no '${role}' lane — the roster declares only ` +
                `${MAESTRO_SHARD_LANES[role].length}. Append lanes to POOL_ROSTER, run poolAdmin --apply, ` +
                'then raise the `maestro_shards` input.',
        );
    }

    return slotFor('maestro', declared);
}

/**
 * The consumable erasure slots one Maestro shard may draw its subject from, in declared order. Pure.
 *
 * ⛔ A STRIDE, not a slice. A slice (`skip the first k`) collides the moment an early slot has already been
 * consumed — both shards then fall through to the same next-available one — and a shared erasure subject is
 * one shard really erasing the account the other is about to sign in as. Striding partitions the declared
 * list, so the sets are disjoint whatever has already been consumed.
 *
 * @param shard - The 1-based shard index.
 * @param shardCount - The stride modulus. ⛔ WHAT GUARANTEES DISJOINTNESS IS THAT EVERY SHARD USES THE
 *     SAME MODULUS, not that it equals the matrix size — which is why callers pass the static
 *     `maestroShardCapacity()` rather than a matrix dimension read from a workflow. Two callers reading
 *     the count from different places is how two shards end up sharing a Clerk identity.
 * @returns This shard's consumable slots; empty when the roster cannot reach that far.
 */
export function maestroConsumableSlots(shard: number, shardCount: number): readonly PoolSlot[] {
    if (!Number.isInteger(shard) || shard < 1 || !Number.isInteger(shardCount) || shardCount < 1) {
        throw new Error(
            `test pool: a Maestro consumable stride needs positive integers, got ${String(shard)}/${String(shardCount)}`,
        );
    }

    return consumableSlots('maestro').filter((_, index) => index % shardCount === shard - 1);
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
 * wholesale, so an empty list is what revokes a grant the roster no longer declares.
 */
export function poolSlotMetadata(slot: PoolLane): PoolSlotMetadata {
    return {
        testPrincipal: true,
        permissions: slot.premium ? ['premium'] : [],
        scopes: [...slot.scopes],
    };
}
