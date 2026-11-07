/**
 * POOL ADMIN — provision the fixed Clerk test pool, and report drift.
 *
 * ## ⛔ The only writer in test tooling
 *
 * This is the ONLY code in test tooling that writes `public_metadata`, and with `runUsers.ts` (a local run's own erasure
 * subject, through this module's port) the only code that creates a Clerk user (`runtimeUserCreation.test.ts` and
 * `metadataSingleWriter.test.ts` hold every other file to that). Outside test
 * tooling exactly one other writer exists, by owner ruling 2026-10-13: the identity webhook merges `roles: ['default']`
 * into a NEW user that has no `roles` key. It never touches a user this command created, because every slot is
 * created with its `roles` in the same call (`poolSlotMetadata`). A test LEASES a
 * slot this command provisioned, and it fails — it does not self-heal — when the slot is absent or unmarked, because
 * a test that creates what it needs is the shape this pool replaced.
 *
 * ## The rulings, and THE place their amendment is recorded
 *
 * Owner ruling 2026-09-13: _"We should have a pool of test users for clerk so that we don't need to create ones"_ —
 * no test run created a user, and this command ran only out of band, by the owner.
 *
 * ⛔ AMENDED by owner ruling 2026-10-08: **the pool refills itself before each Maestro run.** The Maestro job (Android
 * and iOS, sandbox tenant only) runs this command right before it provisions, as
 * `poolAdmin.ts --apply --maestro-erasure --platform P --shard N`, which reconciles ONLY the erasure subjects that
 * platform's shard may lease (`maestroErasureSlots` — that platform's one subject for its erasure shard, none for any other). So a run now tops the pool up, but
 * only through this module, the single writer; the tests themselves still never create a user, and every other slot
 * is still provisioned only by the owner's full run. The reason: each real erasure destroys its subject, the flow
 * runs on every Maestro run and both platforms, and a pool replenished only by hand ran dry
 * (`all 5 consumable slots are consumed`, both platforms, 2026-10-08; the pool has since been trimmed to one subject per platform, 2026-11-06). This paragraph is the one statement of the
 * amendment; everything else cites it.
 *
 * ## What it does
 *
 * For every slot in scope: create the user if nobody holds the address (with the marker in the same call), or
 * merge-PATCH the marker, `roles`, `permissions` and `scopes` if they have drifted. A consumed erasure slot is simply an
 * absent user, so replenishing is the same "create". Every user this run creates is then waited on until the
 * identity webhook has backfilled its `external_id`, because a slot without one answers 401 everywhere. Then every
 * slot in scope is READ AGAIN and judged by the lease's own rule (`judgePoolSlot`): healthy means the next lease of
 * any of them will succeed, not merely that the writes returned.
 *
 * The owner's whole-roster `--apply` also RE-ASSERTS each existing slot's username and names (and, for a slot a flow
 * types a password for, the committed password — so a lane that became password-bearing after it was created, like the
 * Maestro co-author and the web peer of 2026-10-19, can sign in) through
 * `updateUser`, so Clerk emits `user.updated` and the identity webhook fills the profile's username — the one
 * honest path (identity never fills it on read, and this command never writes identity's database). It is idempotent
 * and only the roster scope does it; the Maestro refill leaves existing users alone.
 *
 * ⛔ METADATA IS MERGED, NEVER REPLACED. `updateUser({ publicMetadata })` REPLACES the whole object — the
 * installed `@clerk/backend` marks that use deprecated for exactly this reason — so a second tool writing a
 * different key would silently erase the marker. `updateUserMetadata` deep-merges.
 *
 * DRIFT is any user carrying `testPrincipal: true` who holds no roster address. It is reported, never "fixed":
 * the services trust the marker (ADR-0040 containment and self-purge), so an unexplained holder is an alarm for a
 * human. ⚠️ Only the whole-roster run audits it. The Maestro refill skips the audit: it is an instance-wide listing
 * that costs a Backend API call per hundred users against a limit every suite shares, and a stray user is no reason
 * to fail a mobile run whose own slots are healthy.
 *
 * ## The downgraded owner — CI ensures its world; the by-hand path is a fallback (plan 2026-10-14-009 T2)
 *
 * `roles/roledowngraded` owns a PRIVATE recipe and a PRIVATE collection yet holds no entitled role, which the recipe
 * service refuses to create — so it is made premium, seeded, and only then downgraded. `planPool`'s `phase` decides it.
 *
 * ⛔ AMENDED by owner ruling 2026-10-18: **CI rebuilds that world automatically.** The world lives in the per-PR recipe
 * database, which Sandbox Down and the midnight reclaim drop every cycle, so the `downgraded-owner-world` job of
 * `deployedE2eTiers.yml` runs `e2e-seed`'s `ensureDowngradedWorld.ts` once per run, before the web and Maestro tiers
 * that read the world. It moves the lane through `setLanePhase` below — this module stays the only writer of
 * `public_metadata`, and the job adds no writer — and only when the world is missing or stale; on the common path it
 * writes nothing. `npm run ensure-downgraded --workspace=packages/tools/e2e-seed` is the same command for a local or
 * owner run, and it works whether or not the owner was ever settled.
 *
 * The three manual steps below still exist, but they work ONLY for a lane that was never settled: step 1 never raises
 * an already-settled user (while `seeding`, `planPool` accepts either state), so a settled owner whose world was dropped
 * needs `ensure-downgraded`, not these.
 *
 *   1. `poolAdmin --apply` — creates it `premium` (a plain run never downgrades it, and never upgrades it again).
 *   2. `npm run seed-downgraded --workspace=packages/tools/e2e-seed` — writes its fixed world as that premium cook.
 *   3. `poolAdmin --apply --settle-downgraded` — merges its declared `default` roles. Until step 3 the report says
 *      `UNSETTLED`, and a user step 3 had to create is premium again, so the order is repeated, not skipped.
 *
 * The world is never reset (`resetPool` does not touch the `roles` tier); it is rebuilt only when it is found missing.
 *
 * ## Running it
 *
 *   CLERK_SECRET_KEY=sk_test_… npx tsx packages/tools/e2e-fixtures/src/poolAdmin.ts            # dry run, whole roster
 *   CLERK_SECRET_KEY=sk_test_… npx tsx packages/tools/e2e-fixtures/src/poolAdmin.ts --apply    # owner: write it
 *   … poolAdmin.ts --apply --maestro-erasure --shard N    # the Maestro job's refill (`parsePoolAdminArgs`)
 *
 * The dry run is the default and writes nothing. Exit status is non-zero on drift, on an ambiguous slot, on a slot
 * that is not leasable after the run, or (dry run) when anything is left to do.
 *
 * ⚠️ SANDBOX TENANT ONLY in this phase — a non-development key is refused before a client is built.
 *
 * @pattern Command — one reconciliation, planned purely (`planPool`) and applied by an impure step that holds no policy
 * @pattern Port — `PoolAdminPort`, with `clerkPoolAdminPort` as the Clerk Backend API adapter
 */
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

import { ulid } from 'ulidx';
import { createClerkClient } from '@clerk/backend';
import { isClerkAPIResponseError } from '@clerk/backend/errors';

import { withClerkBackendRetry } from './clerkSession.js';
import { awaitExternalId, EXTERNAL_ID_DEADLINE_MS, EXTERNAL_ID_POLL_MS } from './externalId.js';
import { judgePoolSlot } from './leaseSession.js';
import {
    DEFAULT_POOL_PHASE,
    MAESTRO_PLATFORMS,
    isLocalNamespaceSlot,
    isMaestroPlatform,
    knownPoolAddresses,
    maestroErasureSlots,
    maestroShardCapacity,
    maestroSlotForShard,
    POOL_PASSWORD,
    poolNamespaceFrom,
    poolSlotMetadata,
    rosterSlots,
    type MaestroPlatform,
    type PoolPhase,
    type PoolSlot,
    type PoolSlotMetadata,
} from './testPool.js';

/** A Clerk user reduced to what the reconciliation reads. */
export interface ObservedPoolUser {
    readonly id: string;
    readonly emails: readonly string[];
    readonly publicMetadata: Readonly<Record<string, unknown>>;
    readonly externalId: string | null;
}

/** The Backend API create body for one slot, in `@clerk/backend`'s camelCase shape. */
export interface PoolUserCreate {
    readonly emailAddress: readonly string[];
    readonly username: string;
    readonly password: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly skipPasswordChecks: true;
    readonly publicMetadata: PoolSlotMetadata;
}

/** What the reconciliation needs from Clerk. */
export interface PoolAdminPort {
    readonly findUsers: (email: string) => Promise<readonly ObservedPoolUser[]>;
    /** EVERY user on the instance, for the drift check. */
    readonly listUsers: () => Promise<readonly ObservedPoolUser[]>;
    readonly createUser: (input: PoolUserCreate) => Promise<{ readonly id: string }>;
    readonly mergeMetadata: (userId: string, metadata: PoolSlotMetadata) => Promise<void>;
    readonly readExternalId: (userId: string) => Promise<string | null>;
    /**
     * Set a user's `external_id`. Used only by a local-namespace run, which mints the id the identity webhook writes for the
     * shared pool (see {@link reconcilePool}); absent from a port that is not meant to.
     */
    readonly writeExternalId?: (userId: string, externalId: string) => Promise<void>;
    /**
     * How many users the whole instance holds. Read only by a run that asked for a {@link PoolCapacity} check; a port
     * that cannot count is REFUSED for such a run rather than treated as having room.
     */
    readonly countUsers?: () => Promise<number>;
    /** One user by id, or `undefined` when Clerk holds no user with that id. Read before a run deletes a user it recorded. */
    readonly findUserById?: (userId: string) => Promise<ObservedPoolUser | undefined>;
    /** Delete a user by id: a local run's recorded erasure subject (`runUsers.ts`), or a dispatched k6 run's users. */
    readonly deleteUser?: (userId: string) => Promise<void>;
    /** Re-state a user's username and names, which makes Clerk emit `user.updated`. Never touches metadata. */
    readonly reassertProfile: (userId: string, profile: PoolProfileReassert) => Promise<void>;
}

/**
 * A ceiling on the instance's user count, checked before the first write.
 *
 * ⛔ The Clerk DEVELOPMENT instance holds {@link CLERK_DEVELOPMENT_USER_LIMIT} users in total, and the shared pool already
 * sits near it. A create that runs out of room part-way leaves half a tier, so a run that must create several users
 * states the ceiling and is refused whole, before any write, when they cannot all fit.
 */
export interface PoolCapacity {
    readonly limit: number;
}

/** The development instance's hard cap on users (Clerk's published limit; the instance was at 99 on 2026-10-29). */
export const CLERK_DEVELOPMENT_USER_LIMIT = 100;

/** The profile fields a slot's Clerk user is re-asserted with — the same values the create body carries. */
export interface PoolProfileReassert {
    readonly username: string;
    readonly firstName: string;
    readonly lastName: string;
    /**
     * {@link POOL_PASSWORD}, present ONLY for a slot a flow types a password for. Re-stated here because an existing user
     * was created with a random password (the create body is the only other place a password is written), so a lane that
     * BECAME password-bearing later (the Maestro co-author and the web peer, owner decision 2026-10-19) is otherwise
     * unable to sign in. Absent for every other slot: its random password stays unknown.
     */
    readonly password?: string;
    /** Set with `password`: the committed password is not one the instance's strength rules would pick. */
    readonly skipPasswordChecks?: true;
}

/** Whether a reconciliation re-states existing slots' profiles so Clerk re-emits them to identity. */
export type ProfileReassert = 'reassert' | 'leave';

/** One slot's verdict. */
export type PoolAction =
    | { readonly kind: 'create'; readonly slot: PoolSlot }
    | { readonly kind: 'mark'; readonly slot: PoolSlot; readonly userId: string }
    | { readonly kind: 'ok'; readonly slot: PoolSlot; readonly userId: string }
    | { readonly kind: 'ambiguous'; readonly slot: PoolSlot; readonly userIds: readonly string[] };

/** The whole decision. */
export interface PoolPlan {
    readonly actions: readonly PoolAction[];
    /** Marked users holding no roster address. */
    readonly drift: readonly { readonly id: string; readonly emails: readonly string[] }[];
}

/** The outcome of one reconciliation. */
export interface PoolReport {
    readonly plan: PoolPlan;
    readonly applied: boolean;
    /** Why each slot in scope would be refused by a lease, read AFTER any writes. Empty when every one is leasable. */
    readonly unleasable: readonly string[];
    /**
     * Addresses of slots that do not hold the roles the PHASE asks of them, read AFTER any writes. Settling a downgraded
     * owner that did not exist creates it premium (it has no world to keep yet), so it is unsettled until a later run.
     */
    readonly unsettled: readonly string[];
    /** Nothing ambiguous, no drift, every slot leasable, and — on a dry run — nothing left to do. */
    readonly healthy: boolean;
}

/** Which slots one invocation reconciles. */
export type PoolScope =
    | { readonly kind: 'roster' }
    /**
     * The 2026-10-08 refill: the erasure subjects one Maestro shard of one platform may lease (see this file's header).
     * The platform is REQUIRED since 2026-10-13, when the ten subjects were split between Android and iOS.
     */
    | { readonly kind: 'maestroErasure'; readonly platform: MaestroPlatform; readonly shard: number }
    /**
     * One local Maestro lane's standing users: its signer and its co-author. Never its erasure subject, which only the run
     * that records its id makes (`runUsers.ts`). Only for the local namespace (`main` refuses it otherwise): the shared
     * pool's signers are the owner's, provisioned by the owner's whole-roster run.
     */
    | { readonly kind: 'maestroLane'; readonly platform: MaestroPlatform; readonly shard: number }
    /**
     * The `roles` tier of the LOCAL namespace: `test-local-roledefault` and its siblings, which `paidFeaturesByRole` and
     * `makePublicConfirm` sign in as and no other local scope makes. Opt-in, local-only, and capacity-checked (see
     * {@link PoolCapacity}). The downgraded owner is created premium, as in the whole-roster run; its world is built by
     * `e2e-seed`'s `ensure-downgraded`.
     */
    | { readonly kind: 'localRoles' }
    /**
     * The k6 tier's eleven users (alfa..juliett and admin), made at the start of a DISPATCHED load test and deleted at its
     * end (owner ruling 2026-11-06, which reverses the 2026-09-13 fixed-pool rule for k6 only). The SHARED namespace: they
     * are the tier's own users for the run's length, and `refuseUnsafeScope` refuses the local one.
     */
    | { readonly kind: 'k6Run' };

/** Whether a reconciliation lists the whole instance to report drift. */
export type DriftAudit = 'audit' | 'skip';

/** What a scope reconciles, and whether it audits drift. Pure. */
export function poolScopeOptions(scope: PoolScope): {
    readonly slots: readonly PoolSlot[];
    readonly drift: DriftAudit;
    readonly profile: ProfileReassert;
} {
    switch (scope.kind) {
        case 'roster':
            return { slots: rosterSlots(), drift: 'audit', profile: 'reassert' };
        case 'maestroErasure':
            // The CI refill creates fresh users (whose `user.created` carries the profile) and must not spend the
            // instance-wide Backend API limit re-writing slots it did not create.
            return { slots: maestroErasureSlots(scope.platform, scope.shard), drift: 'skip', profile: 'leave' };
        case 'localRoles':
            return {
                slots: rosterSlots().filter((slot) => slot.tier === 'roles' && isLocalNamespaceSlot(slot)),
                drift: 'skip',
                profile: 'leave',
            };
        case 'k6Run':
            return {
                slots: rosterSlots().filter((slot) => slot.tier === 'k6'),
                drift: 'skip',
                profile: 'leave',
            };
        case 'maestroLane':
            return {
                slots: [
                    maestroSlotForShard('signer', scope.platform, scope.shard),
                    maestroSlotForShard('coauthor', scope.platform, scope.shard),
                ],
                drift: 'skip',
                profile: 'leave',
            };
    }
}

/**
 * Refuse a scope the namespace makes unsafe, before any client call. Pure.
 *
 * ⛔ The WHOLE ROSTER in the local namespace would create every roster lane as `test-local-*` - about 92 users on a
 * development instance that holds 100 in total - and is nobody's intent: the whole roster is the owner's run against the
 * shared pool. `--local-roles` makes users only a local run may.
 *
 * @param scope - What the command line asked for.
 * @param local - Whether the local namespace is active.
 * @throws When the scope does not belong to the namespace.
 */
export function refuseUnsafeScope(scope: PoolScope, local: boolean): void {
    if (scope.kind === 'roster' && local) {
        throw new Error(
            "poolAdmin: the whole roster is the shared pool's owner run - with E2E_POOL_NAMESPACE=local it would create " +
                'every lane as a test-local user. Name a local scope (--maestro-lane, --local-roles) or unset the namespace.',
        );
    }

    // A local subject made here would be one no run recorded, so no run could ever delete it (owner ruling 2026-11-07).
    if (scope.kind === 'maestroErasure' && local) {
        throw new Error(
            "poolAdmin: --maestro-erasure refills CI's shared erasure subjects - a local run makes its own through " +
                '--create-run-erasure-subject, which records the id it must delete',
        );
    }

    if (scope.kind === 'k6Run' && local) {
        throw new Error(
            "poolAdmin: --k6-run makes the shared pool's k6 users for a dispatched load test - unset E2E_POOL_NAMESPACE",
        );
    }

    if (scope.kind === 'localRoles' && !local) {
        throw new Error(
            "poolAdmin: --local-roles makes the local namespace's role users - set E2E_POOL_NAMESPACE=local",
        );
    }
}

/** A parsed command line. */
export interface PoolAdminArgs {
    readonly apply: boolean;
    /** `settled` only with `--settle-downgraded`; see {@link planPool}. */
    readonly phase: PoolPhase;
    readonly scope: PoolScope;
    /** `--delete` (with `--k6-run`): DELETE the k6 run's users instead of making them; see {@link deleteK6RunUsers}. */
    readonly deleteRun?: true;
}

/** Node's own strict argv parser: an unknown option or a stray positional throws. Pure. */
function readPoolAdminArgv(argv: readonly string[]) {
    return parseArgs({
        args: [...argv],
        strict: true,
        allowPositionals: false,
        tokens: true,
        options: {
            apply: { type: 'boolean' },
            'maestro-erasure': { type: 'boolean' },
            'maestro-lane': { type: 'boolean' },
            'local-roles': { type: 'boolean' },
            'k6-run': { type: 'boolean' },
            delete: { type: 'boolean' },
            platform: { type: 'string' },
            shard: { type: 'string' },
            'settle-downgraded': { type: 'boolean' },
        },
    });
}

/**
 * Read the command line. Pure.
 *
 * ⛔ Anything it does not recognise is REFUSED rather than ignored: this command writes Clerk users, and a typo'd
 * scope flag that fell back to the whole roster would turn a CI refill into the owner's full run.
 *
 * @param argv - The arguments after the script path.
 * @throws On an unknown argument, a repeated `--shard` or `--platform`, a platform that is not `android` or `ios`, or
 *   `--maestro-erasure`, `--platform` and `--shard` not given together.
 */
export function parsePoolAdminArgs(argv: readonly string[]): PoolAdminArgs {
    let parsed: ReturnType<typeof readPoolAdminArgv>;

    try {
        parsed = readPoolAdminArgv(argv);
    } catch (error) {
        throw new Error(`poolAdmin: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }

    const apply = parsed.values.apply === true;
    const phase: PoolPhase = parsed.values['settle-downgraded'] === true ? 'settled' : DEFAULT_POOL_PHASE;
    const erasure = parsed.values['maestro-erasure'] === true;
    const shard = parsed.values.shard;
    const platform = parsed.values.platform;

    // `parseArgs` keeps the LAST of a repeated option; two shards or platforms named is a caller that has not decided.
    for (const name of ['shard', 'platform']) {
        if (parsed.tokens.filter((token) => token.kind === 'option' && token.name === name).length > 1) {
            throw new Error(`poolAdmin: --${name} may be given once`);
        }
    }

    const lane = parsed.values['maestro-lane'] === true;
    const k6Run = parsed.values['k6-run'] === true;
    const deleteRun = parsed.values.delete === true;

    if (deleteRun && !k6Run) {
        throw new Error(
            'poolAdmin: --delete applies only to a --k6-run (a local Maestro run deletes its own subject with --delete-run-users)',
        );
    }

    if (k6Run) {
        if (
            lane ||
            erasure ||
            phase === 'settled' ||
            shard !== undefined ||
            platform !== undefined ||
            parsed.values['local-roles'] === true
        ) {
            throw new Error(
                'poolAdmin: --k6-run stands alone - it takes no --maestro-lane, --maestro-erasure, ' +
                    '--local-roles, --settle-downgraded, --platform or --shard',
            );
        }

        return { apply, phase, scope: { kind: 'k6Run' }, ...(deleteRun ? { deleteRun: true as const } : {}) };
    }

    const localRoles = parsed.values['local-roles'] === true;

    if (localRoles) {
        if (lane || erasure || phase === 'settled' || shard !== undefined || platform !== undefined) {
            throw new Error(
                'poolAdmin: --local-roles stands alone - it takes no --maestro-lane, --maestro-erasure, ' +
                    '--settle-downgraded, --platform or --shard',
            );
        }

        return { apply, phase, scope: { kind: 'localRoles' } };
    }

    if (lane && erasure) {
        throw new Error('poolAdmin: --maestro-lane and --maestro-erasure are separate scopes; give one of the two');
    }

    if (!erasure && !lane) {
        if (shard !== undefined || platform !== undefined) {
            throw new Error('poolAdmin: --shard and --platform scope only a --maestro-erasure or --maestro-lane run');
        }

        return { apply, phase, scope: { kind: 'roster' } };
    }

    // The CI refill reconciles consumable erasure subjects; settling the owner's downgraded lane is the owner's alone.
    if (phase === 'settled') {
        throw new Error(
            'poolAdmin: --settle-downgraded is the owner’s whole-roster run, not a --maestro-erasure or --maestro-lane run',
        );
    }

    if (platform === undefined) {
        throw new Error(
            'poolAdmin: --maestro-erasure and --maestro-lane need --platform android|ios, the platform whose users to reconcile',
        );
    }

    if (shard === undefined) {
        throw new Error(
            'poolAdmin: --maestro-erasure and --maestro-lane need --shard N, the Maestro shard whose users to reconcile',
        );
    }

    // Exact match, no trimming or case folding: this scope decides WHICH users a CI job creates.
    if (!isMaestroPlatform(platform)) {
        throw new Error(`poolAdmin: --platform '${platform}' is not one of ${MAESTRO_PLATFORMS.join(', ')}`);
    }

    // Digits only, anchored: `Number(' 1')` is 1, and every leniency is a scope nobody stated.
    if (!/^[0-9]+$/u.test(shard) || Number(shard) < 1) {
        throw new Error(`poolAdmin: --shard '${shard}' is not a positive integer`);
    }

    return {
        apply,
        phase,
        scope: { kind: lane ? 'maestroLane' : 'maestroErasure', platform, shard: Number(shard) },
    };
}

/**
 * Read `--list-local-lanes --platform <p>`, which takes nothing else. Pure.
 *
 * It is its own command line, not a scope of {@link parsePoolAdminArgs}: it reconciles nothing, so no flag that writes
 * may ride along with it.
 *
 * @throws On any other argument, or a platform that is not `android` or `ios`.
 */
export function parseListLocalLanesArgs(argv: readonly string[]): { readonly platform: MaestroPlatform } {
    let parsed;

    try {
        parsed = parseArgs({
            args: [...argv],
            strict: true,
            allowPositionals: false,
            options: { 'list-local-lanes': { type: 'boolean' }, platform: { type: 'string' } },
        });
    } catch (error) {
        throw new Error(`poolAdmin: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }

    const platform = parsed.values.platform;

    if (parsed.values['list-local-lanes'] !== true || platform === undefined || !isMaestroPlatform(platform)) {
        throw new Error(
            `poolAdmin: --list-local-lanes needs --platform ${MAESTRO_PLATFORMS.join('|')} and nothing else`,
        );
    }

    return { platform };
}

/** Which local Maestro lanes of one platform have their Clerk users. */
export interface LocalLaneReport {
    readonly lanes: readonly { readonly index: number; readonly signer: boolean; readonly coauthor: boolean }[];
    /** Lanes counted from 1 while both users exist: lane `k` runs as shard `k`, so the first gap ends it. */
    readonly present: number;
    /** Whether the platform's erasure subject, which lane 1 leases, exists. */
    readonly erasureSubject: boolean;
}

/**
 * List a platform's LOCAL Maestro lanes. Reads Clerk and writes nothing: a lane run counts its lanes with this and never
 * makes a lane user (adding a lane is the owner's `--apply --maestro-lane` run).
 *
 * @sideEffect Reads Clerk users through the port.
 * @throws When the local namespace is not active, before any read.
 */
export async function listLocalLanes(
    port: Pick<PoolAdminPort, 'findUsers'>,
    platform: MaestroPlatform,
): Promise<LocalLaneReport> {
    if (poolNamespaceFrom(process.env) !== 'local') {
        throw new Error('poolAdmin: --list-local-lanes lists the local lanes - set E2E_POOL_NAMESPACE=local');
    }

    const exists = async (email: string): Promise<boolean> => (await port.findUsers(email)).length > 0;
    const lanes = [];

    for (let index = 1; index <= maestroShardCapacity(platform); index += 1) {
        lanes.push({
            index,
            signer: await exists(maestroSlotForShard('signer', platform, index).email),
            coauthor: await exists(maestroSlotForShard('coauthor', platform, index).email),
        });
    }

    const gap = lanes.findIndex((lane) => !lane.signer || !lane.coauthor);
    const subject = maestroErasureSlots(platform, 1)[0];

    return {
        lanes,
        present: gap === -1 ? lanes.length : gap,
        erasureSubject: subject !== undefined && (await exists(subject.email)),
    };
}

/** One line per lane, the erasure subject, then `lanes=<present>`. Pure. */
export function describeLocalLanes(report: LocalLaneReport): readonly string[] {
    const state = (present: boolean): string => (present ? 'present' : 'missing');

    return [
        ...report.lanes.map(
            (lane) => `lane ${lane.index} signer=${state(lane.signer)} coauthor=${state(lane.coauthor)}`,
        ),
        `erasure-subject=${state(report.erasureSubject)}`,
        `lanes=${report.present}`,
    ];
}

const sameList = (actual: unknown, desired: readonly string[]): boolean =>
    Array.isArray(actual) &&
    actual.length === desired.length &&
    [...actual].map(String).sort().join('\n') === [...desired].sort().join('\n');

/**
 * Whether a user's metadata already carries what the roster declares. Keys the roster does not own are ignored,
 * because a merge-PATCH leaves them alone. Pure.
 */
export function metadataSatisfies(actual: Readonly<Record<string, unknown>>, desired: PoolSlotMetadata): boolean {
    return (
        actual['testPrincipal'] === true &&
        sameList(actual['roles'], desired.roles) &&
        sameList(actual['permissions'], desired.permissions) &&
        sameList(actual['scopes'], desired.scopes)
    );
}

/**
 * Whether a user's metadata is acceptable for its slot in a phase. Pure.
 *
 * A lane with one state asks for exactly its metadata. A downgraded owner (`seedRoles`) is acceptable in either state
 * while `seeding` and only in its declared one when `settled` — which is what makes a plain run idempotent on both
 * sides of the downgrade.
 */
function holdsInPhase(actual: Readonly<Record<string, unknown>>, slot: PoolSlot, phase: PoolPhase): boolean {
    return phase === 'settled' || slot.seedRoles === undefined
        ? metadataSatisfies(actual, poolSlotMetadata(slot, phase))
        : metadataSatisfies(actual, poolSlotMetadata(slot, 'seeding')) ||
              metadataSatisfies(actual, poolSlotMetadata(slot, 'settled'));
}

/**
 * Decide, purely, what the reconciliation does.
 *
 * @param slots - The roster slots to reconcile.
 * @param holders - For each slot address, the users holding it. A slot the map does not answer is ABSENT.
 * @param everyone - Every user on the instance, for drift.
 * @param phase - What a lane with `seedRoles` (a downgraded owner) is asked to hold. While `seeding`, an existing user
 *   is left as it is if it holds EITHER state — a plain run must neither downgrade the owner before its world is seeded
 *   nor upgrade it again after. Only `settled` moves a premium user to its declared roles.
 */
export function planPool(
    slots: readonly PoolSlot[],
    holders: ReadonlyMap<string, readonly ObservedPoolUser[]>,
    everyone: readonly ObservedPoolUser[],
    phase: PoolPhase = DEFAULT_POOL_PHASE,
): PoolPlan {
    const actions = slots.map((slot): PoolAction => {
        const found = holders.get(slot.email) ?? [];
        const [only, ...others] = found;

        if (only === undefined) {
            return { kind: 'create', slot };
        }

        if (others.length > 0) {
            return { kind: 'ambiguous', slot, userIds: found.map((holder) => holder.id) };
        }

        return holdsInPhase(only.publicMetadata, slot, phase)
            ? { kind: 'ok', slot, userId: only.id }
            : { kind: 'mark', slot, userId: only.id };
    });

    // Both namespaces: a developer's local user is marked and holds no SHARED address, and is not a stray.
    const roster = knownPoolAddresses();
    const drift = everyone
        .filter((candidate) => candidate.publicMetadata['testPrincipal'] === true)
        .filter((candidate) => !candidate.emails.some((email) => roster.has(email.toLowerCase())))
        .map((candidate) => ({ id: candidate.id, emails: candidate.emails }));

    return { actions, drift };
}

/**
 * The create body for a slot. Pure over its inputs.
 *
 * The instance requires first/last name AND a username. A slot a flow types a password for gets the committed
 * {@link POOL_PASSWORD}; every other slot signs in only by ticket, so it gets a random password nobody holds.
 */
export function poolUserCreateInput(slot: PoolSlot, randomPassword: string): PoolUserCreate {
    return {
        emailAddress: [slot.email],
        username: slot.username,
        password: slot.signsInByPassword ? POOL_PASSWORD : randomPassword,
        firstName: 'Test',
        lastName: slot.id,
        skipPasswordChecks: true,
        // ⛔ ALWAYS the seeding roles: a downgraded owner created as `default` could never have its private world written.
        publicMetadata: poolSlotMetadata(slot, 'seeding'),
    };
}

/**
 * A password nobody holds, for a slot that signs in only by ticket. It meets the instance's character classes.
 *
 * @sideEffect Reads the system's randomness.
 */
export function randomPoolPassword(): string {
    return `Pp1!${randomBytes(24).toString('base64url')}`;
}

/**
 * The profile a slot's Clerk user is re-asserted with: exactly the username and names its create body carries, plus the
 * committed password for a slot that signs in by password. Pure.
 *
 * Identity learns a username ONLY from the `user.created` / `user.updated` webhook (never filled on read), so a slot
 * whose identity profile was made before the username column existed gets it when Clerk re-emits the user.
 */
export function poolProfileReassert(slot: PoolSlot): PoolProfileReassert {
    const { username, firstName, lastName } = poolUserCreateInput(slot, '');

    return slot.signsInByPassword
        ? { username, firstName, lastName, password: POOL_PASSWORD, skipPasswordChecks: true }
        : { username, firstName, lastName };
}

/**
 * Every user holding each slot's address, one lookup at a time (the Backend API limit is instance-wide).
 *
 * @sideEffect One Backend API lookup per slot.
 */
async function observeSlots(
    port: PoolAdminPort,
    slots: readonly PoolSlot[],
): Promise<ReadonlyMap<string, readonly ObservedPoolUser[]>> {
    const holders = new Map<string, readonly ObservedPoolUser[]>();

    for (const slot of slots) {
        holders.set(slot.email, await port.findUsers(slot.email));
    }

    return holders;
}

/** Why a lease would refuse each slot, by the lease's own rule; empty when every slot is leasable. Pure. */
function unleasableSlots(
    slots: readonly PoolSlot[],
    holders: ReadonlyMap<string, readonly ObservedPoolUser[]>,
): readonly string[] {
    return slots.flatMap((slot) => {
        const verdict = judgePoolSlot(slot, holders.get(slot.email) ?? []);

        return 'refusal' in verdict ? [verdict.refusal] : [];
    });
}

/**
 * The addresses of slots that do not hold what the phase asks of them. Pure.
 *
 * Only `settled` can leave one: a downgraded owner the run had to CREATE is premium (see {@link poolUserCreateInput}),
 * and "settled" is a claim that its world has been seeded, which a run that just created it cannot make.
 */
function unsettledSlots(
    slots: readonly PoolSlot[],
    holders: ReadonlyMap<string, readonly ObservedPoolUser[]>,
    phase: PoolPhase,
): readonly string[] {
    if (phase !== 'settled') {
        return [];
    }

    return slots
        .filter((slot) => slot.seedRoles !== undefined)
        .filter(
            (slot) =>
                !(holders.get(slot.email) ?? []).some((holder) => holdsInPhase(holder.publicMetadata, slot, phase)),
        )
        .map((slot) => slot.email);
}

/**
 * Refuse a run whose creates would not all fit.
 *
 * @param port - Must be able to `countUsers`.
 * @param creates - How many users the plan would create.
 * @param capacity - The instance's ceiling.
 * @throws When the port cannot count, or `total + creates` exceeds the ceiling. Nothing has been written yet.
 * @sideEffect One Backend API read, and only when there is something to create.
 */
async function assertRoomToCreate(port: PoolAdminPort, creates: number, capacity: PoolCapacity): Promise<void> {
    if (port.countUsers === undefined) {
        throw new Error(
            'poolAdmin: a capacity check was asked for but this port has no countUsers - refusing to guess',
        );
    }

    if (creates === 0) {
        return;
    }

    const total = await port.countUsers();

    if (total + creates > capacity.limit) {
        throw new Error(
            `poolAdmin: creating ${creates} user(s) would take the instance from ${total} to ${total + creates}, past ` +
                `its limit of ${capacity.limit}. Nothing was created. Free room first (a prune of the dev instance).`,
        );
    }
}

/**
 * Observe, plan, and — only with `apply` — write.
 *
 * Writes happen one at a time: the Backend API limit is instance-wide and shared with every suite running
 * against the dev instance.
 *
 * @sideEffect Reads the slots in scope (and, auditing drift, every Clerk user); with `apply`, creates users,
 *   writes metadata, (with `profile: 'reassert'`) re-states existing slots' username and names, polls for
 *   `external_id`, then reads the slots in scope again.
 */
export async function reconcilePool(
    port: PoolAdminPort,
    options: {
        readonly apply: boolean;
        readonly slots?: readonly PoolSlot[];
        /** Required: whether drift is audited is a decision about cost and blast radius, never a default. */
        readonly drift: DriftAudit;
        /** Default `'leave'`: re-writing existing users is a decision about the Backend API budget, never implicit. */
        readonly profile?: ProfileReassert;
        /** Default `'seeding'`: moving a downgraded owner to its settled roles is a decision, never implicit. */
        readonly phase?: PoolPhase;
        /**
         * Mint each slot's `external_id` here instead of waiting for the identity webhook to write it. For the LOCAL
         * namespace only: the shared pool's webhook belongs to the sandbox, which is down when the sandbox is, and it must
         * never be asked of a user that belongs to CI. An id a user already holds is never replaced.
         */
        readonly externalId?: { readonly mint: () => string };
        /**
         * Refuse, before the first write, when creating every missing user would take the instance past `limit`. Needs a
         * port that can `countUsers`.
         */
        readonly capacity?: PoolCapacity;
        readonly randomPassword: () => string;
        readonly now: () => number;
        readonly sleep: (ms: number) => Promise<void>;
    },
): Promise<PoolReport> {
    const slots = options.slots ?? rosterSlots();
    const holders = await observeSlots(port, slots);
    const phase = options.phase ?? DEFAULT_POOL_PHASE;
    const plan = planPool(slots, holders, options.drift === 'audit' ? await port.listUsers() : [], phase);
    const broken = plan.drift.length > 0 || plan.actions.some((action) => action.kind === 'ambiguous');
    const pending = plan.actions.some((action) => action.kind === 'create' || action.kind === 'mark');

    if (options.capacity !== undefined) {
        await assertRoomToCreate(
            port,
            plan.actions.filter((action) => action.kind === 'create').length,
            options.capacity,
        );
    }

    if (!options.apply) {
        const unleasable = unleasableSlots(slots, holders);
        const unsettled = unsettledSlots(slots, holders, phase);

        return {
            plan,
            applied: false,
            unleasable,
            unsettled,
            healthy: !broken && !pending && unleasable.length === 0 && unsettled.length === 0,
        };
    }

    const created: { readonly slot: PoolSlot; readonly id: string }[] = [];

    for (const action of plan.actions) {
        if (action.kind === 'mark') {
            await port.mergeMetadata(action.userId, poolSlotMetadata(action.slot, phase));

            if (options.profile === 'reassert') {
                await port.reassertProfile(action.userId, poolProfileReassert(action.slot));
            }
        } else if (action.kind === 'create') {
            const { id } = await port.createUser(poolUserCreateInput(action.slot, options.randomPassword()));
            created.push({ slot: action.slot, id });
        } else if (action.kind === 'ok' && options.profile === 'reassert') {
            await port.reassertProfile(action.userId, poolProfileReassert(action.slot));
        }
    }

    if (options.externalId === undefined) {
        for (const { slot, id } of created) {
            await awaitExternalId(slot.email, {
                deadlineMs: EXTERNAL_ID_DEADLINE_MS,
                pollMs: EXTERNAL_ID_POLL_MS,
                read: () => port.readExternalId(id),
                now: options.now,
                sleep: options.sleep,
            });
        }
    } else {
        await mintMissingExternalIds(port, slots, options.externalId.mint);
    }

    // Judged on a FRESH read, never on the plan: a write that returned is not a slot a lease will accept.
    const after = await observeSlots(port, slots);
    const unleasable = unleasableSlots(slots, after);
    const unsettled = unsettledSlots(slots, after, phase);

    return {
        plan,
        applied: true,
        unleasable,
        unsettled,
        healthy: !broken && unleasable.length === 0 && unsettled.length === 0,
    };
}

/**
 * Delete the users of the k6 tier at the end of a dispatched load test, and create nothing.
 *
 * ⛔ As narrow as the creation door. Every slot is checked BEFORE the first lookup: it must belong to the `k6` tier and
 * carry the SHARED address, so a signer, an erasure subject, a web or role user, or a local copy is refused. (Unlike
 * {@link deleteLocalConsumables} it admits shared users, because the k6 tier's users are made for the run and are nobody
 * else's; that is the one reason it is a separate function rather than a flag.)
 *
 * @param port - Must be able to `deleteUser`.
 * @param slots - The slots whose holders to delete.
 * @param apply - `false` only names who would go.
 * @returns The ids deleted (or, on a dry run, that would be).
 * @throws On a slot that is not a shared k6 slot, or a port that cannot delete.
 * @sideEffect One Backend API read per slot and, with `apply`, one delete per user found.
 */
export async function deleteK6RunUsers(
    port: Pick<PoolAdminPort, 'findUsers' | 'deleteUser'>,
    slots: readonly PoolSlot[],
    apply: boolean,
): Promise<readonly string[]> {
    for (const slot of slots) {
        if (slot.tier !== 'k6') {
            throw new Error(`poolAdmin: ${slot.tier}/${slot.id} is not a k6 slot, so a k6 run does not delete it`);
        }

        if (isLocalNamespaceSlot(slot)) {
            throw new Error(`poolAdmin: k6/${slot.id} is a local-namespace copy, not the shared k6 user a run makes`);
        }
    }

    if (port.deleteUser === undefined) {
        throw new Error('poolAdmin: deleting the k6 run users needs a port with deleteUser');
    }

    const ids: string[] = [];

    for (const slot of slots) {
        for (const holder of await port.findUsers(slot.email)) {
            if (apply) {
                await port.deleteUser(holder.id);
            }

            ids.push(holder.id);
        }
    }

    return ids;
}

/**
 * Give every slot's user that holds no `external_id` one.
 *
 * Reads each holder FRESH and writes only when it is empty, so an id another writer put there (the sandbox webhook, for a
 * user it learned of late) is kept and a rerun is a no-op. The local alignment then adopts whatever the user holds.
 *
 * @sideEffect One Backend API read per slot and one write per user without an id.
 * @throws When the port cannot write.
 */
async function mintMissingExternalIds(
    port: PoolAdminPort,
    slots: readonly PoolSlot[],
    mint: () => string,
): Promise<void> {
    if (port.writeExternalId === undefined) {
        throw new Error('poolAdmin: minting external ids needs a port with writeExternalId');
    }

    for (const slot of slots) {
        for (const holder of await port.findUsers(slot.email)) {
            if (holder.externalId === null || holder.externalId === '') {
                await port.writeExternalId(holder.id, mint());
            }
        }
    }
}

/**
 * The ONE holder of a lane's address, or a refusal naming why there is none. Pure over the lookup it is given.
 *
 * @throws When nobody holds the address (not provisioned) or more than one user does (ambiguous).
 */
function onlyHolder(slot: PoolSlot, found: readonly ObservedPoolUser[]): ObservedPoolUser {
    const [only, ...others] = found;

    if (only === undefined) {
        throw new Error(`poolAdmin: ${slot.email} is not provisioned — no user holds it (run poolAdmin --apply)`);
    }

    if (others.length > 0) {
        throw new Error(`poolAdmin: more than one user holds ${slot.email} — ambiguous, nothing was written`);
    }

    return only;
}

/**
 * Whether a lane's user carries EXACTLY the metadata a phase declares. A lane nobody holds, or two people hold, is
 * `false`: a caller that asks "is it settled?" must not be told yes about a user it cannot identify.
 *
 * @sideEffect One Backend API lookup.
 */
export async function laneHoldsPhase(port: PoolAdminPort, slot: PoolSlot, phase: PoolPhase): Promise<boolean> {
    const found = await port.findUsers(slot.email);

    return found.length === 1 && metadataSatisfies(found[0]?.publicMetadata ?? {}, poolSlotMetadata(slot, phase));
}

/**
 * Move ONE two-state lane (a downgraded owner) to a phase, in either direction, and prove the write held.
 *
 * Added 2026-10-18 for the CI job that rebuilds the downgraded owner's world: `reconcilePool` can only settle (move
 * down) such a lane — a plain run leaves either state alone — so a settled owner whose recipe database was dropped
 * could never be raised to be seeded again. This stays in THIS module because it writes `public_metadata`, which
 * `metadataSingleWriter.test.ts` allows no other file to do. It merges (never replaces) and refuses every lane that
 * has a single state, so it cannot be turned on a signer or a consumable.
 *
 * @throws When the lane has one state, is not provisioned, is ambiguous, or does not hold the phase after the write.
 * @sideEffect Two Backend API lookups and one merge-PATCH of the lane's `public_metadata`.
 */
export async function setLanePhase(port: PoolAdminPort, slot: PoolSlot, phase: PoolPhase): Promise<void> {
    if (slot.seedRoles === undefined) {
        throw new Error(
            `poolAdmin: ${slot.email} has a single state (no seedRoles) — only a downgraded owner moves between phases`,
        );
    }

    const holder = onlyHolder(slot, await port.findUsers(slot.email));

    await port.mergeMetadata(holder.id, poolSlotMetadata(slot, phase));

    // Judged on a FRESH read: a PATCH that returned is not a role the next token carries.
    if (!(await laneHoldsPhase(port, slot, phase))) {
        throw new Error(`poolAdmin: ${slot.email} does not hold its ${phase} roles after the write — it did not take`);
    }
}

/** 429s a reconciliation waits out before it gives up. Its creates are paced by Clerk's own retry-after. */
const RATE_LIMIT_RETRIES = 12;

/** The longest single 429 wait a reconciliation sits through. */
const MAX_RATE_LIMIT_WAIT_SECONDS = 30;

/** Users per Backend API page — the maximum the list endpoint serves. */
const PAGE_SIZE = 100;

/**
 * The {@link PoolAdminPort} over Clerk's Backend API.
 *
 * @sideEffect The returned port reads and writes Clerk users.
 */
export function clerkPoolAdminPort(
    secretKey: string,
    options: { readonly sleep?: (ms: number) => Promise<unknown> } = {},
): PoolAdminPort {
    if (!secretKey.startsWith('sk_test_')) {
        throw new Error(
            'poolAdmin: the secret key is not a development instance key — this phase provisions sandbox only',
        );
    }

    const clerk = createClerkClient({ secretKey });
    // An out-of-band reconciliation has no deadline worth failing for, so it waits out far more 429s than a CI
    // session does; how each wait is chosen is the shared policy.
    const backend = <T>(call: () => Promise<T>): Promise<T> =>
        withClerkBackendRetry(call, {
            retries: RATE_LIMIT_RETRIES,
            maxWaitSeconds: MAX_RATE_LIMIT_WAIT_SECONDS,
            sleep: options.sleep,
        });
    const observe = (found: {
        readonly id: string;
        readonly emailAddresses: readonly { readonly emailAddress: string }[];
        readonly publicMetadata: Readonly<Record<string, unknown>>;
        readonly externalId: string | null;
    }): ObservedPoolUser => ({
        id: found.id,
        emails: found.emailAddresses.map((address) => address.emailAddress),
        publicMetadata: found.publicMetadata,
        externalId: found.externalId,
    });

    return {
        findUsers: async (email) =>
            (await backend(() => clerk.users.getUserList({ emailAddress: [email] }))).data.map(observe),
        listUsers: async () => {
            const everyone: ObservedPoolUser[] = [];

            for (let offset = 0; ; offset += PAGE_SIZE) {
                const page = await backend(() => clerk.users.getUserList({ limit: PAGE_SIZE, offset }));
                everyone.push(...page.data.map(observe));

                if (page.data.length < PAGE_SIZE || everyone.length >= page.totalCount) {
                    return everyone;
                }
            }
        },
        createUser: async (input) => {
            const created = await backend(() =>
                clerk.users.createUser({
                    ...input,
                    emailAddress: [...input.emailAddress],
                    publicMetadata: { ...input.publicMetadata },
                }),
            );

            return { id: created.id };
        },
        mergeMetadata: async (userId, metadata) => {
            await backend(() => clerk.users.updateUserMetadata(userId, { publicMetadata: { ...metadata } }));
        },
        reassertProfile: async (userId, profile) => {
            await backend(() => clerk.users.updateUser(userId, { ...profile }));
        },
        countUsers: () => backend(() => clerk.users.getCount()),
        readExternalId: async (userId) => (await backend(() => clerk.users.getUser(userId))).externalId,
        writeExternalId: async (userId, externalId) => {
            await backend(() => clerk.users.updateUser(userId, { externalId }));
        },
        findUserById: async (userId) => {
            try {
                return observe(await backend(() => clerk.users.getUser(userId)));
            } catch (error) {
                // Only Clerk's own "no such user" means absent; any other failure must not read as "already gone".
                if (isClerkAPIResponseError(error) && error.status === 404) {
                    return undefined;
                }

                throw error;
            }
        },
        deleteUser: async (userId) => {
            await backend(() => clerk.users.deleteUser(userId));
        },
    };
}

/** One line per slot, then drift. Pure. */
export function describeReport(report: PoolReport): readonly string[] {
    return [
        ...report.plan.actions.map((action) => {
            const where = `${action.slot.tier}/${action.slot.id} ${action.slot.email}`;

            return action.kind === 'ambiguous'
                ? `AMBIGUOUS ${where}: ${action.userIds.join(', ')}`
                : `${action.kind} ${where}`;
        }),
        ...report.plan.drift.map(
            (stray) => `DRIFT marked user ${stray.id} holds no roster address: ${stray.emails.join(', ')}`,
        ),
        ...report.unleasable.map((refusal) => `UNLEASABLE ${refusal}`),
        ...report.unsettled.map(
            (email) => `UNSETTLED ${email} does not yet hold its settled roles — seed it, then run again`,
        ),
        `${report.applied ? 'applied' : 'dry run (pass --apply to write)'} — ${report.healthy ? 'healthy' : 'NOT healthy'}`,
    ];
}

/**
 * The CLI.
 *
 * @sideEffect Reads the environment, calls Clerk, writes to stdout/stderr, and sets the exit code.
 */
async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const command = argv.includes('--list-local-lanes')
        ? ({ kind: 'list', ...parseListLocalLanesArgs(argv) } as const)
        : ({ kind: 'reconcile', args: parsePoolAdminArgs(argv) } as const);
    const secretKey = process.env['CLERK_SECRET_KEY'] ?? '';

    if (secretKey.trim() === '') {
        throw new Error('poolAdmin: CLERK_SECRET_KEY is required');
    }

    // Built FIRST, whatever the scope: it is what refuses a non-development key, and a refill that has nothing to
    // do must still refuse to hold a production one.
    const port = clerkPoolAdminPort(secretKey);

    if (command.kind === 'list') {
        for (const line of describeLocalLanes(await listLocalLanes(port, command.platform))) {
            console.log(line);
        }

        return;
    }

    const { args } = command;
    const scoped = poolScopeOptions(args.scope);
    const local = poolNamespaceFrom(process.env) === 'local';

    if (args.scope.kind === 'maestroLane' && !local) {
        throw new Error(
            'poolAdmin: --maestro-lane provisions signers, which only the local namespace may — set E2E_POOL_NAMESPACE=local',
        );
    }

    refuseUnsafeScope(args.scope, local);

    if (args.scope.kind === 'maestroErasure' && scoped.slots.length === 0) {
        console.log(`maestro shard ${args.scope.shard} leases no erasure subject — nothing to refill`);
    }

    if (args.deleteRun === true) {
        const ids = await deleteK6RunUsers(port, scoped.slots, args.apply);

        for (const id of ids) {
            console.log(`${args.apply ? 'deleted' : 'would delete'} k6 run user ${id}`);
        }

        console.log(`${args.apply ? 'applied' : 'dry run (pass --apply to delete)'} - ${ids.length} user(s)`);

        return;
    }

    const report = await reconcilePool(port, {
        apply: args.apply,
        phase: args.phase,
        ...scoped,
        // The local namespace's users have no sandbox webhook to write their id (see `testPool.ts`'s `PoolNamespace`).
        ...(local ? { externalId: { mint: ulid } } : {}),
        ...(args.scope.kind === 'localRoles' || args.scope.kind === 'k6Run'
            ? { capacity: { limit: CLERK_DEVELOPMENT_USER_LIMIT } }
            : {}),
        randomPassword: randomPoolPassword,
        now: Date.now,
        sleep: (ms) => delay(ms),
    });

    for (const line of describeReport(report)) {
        console.log(line);
    }

    process.exitCode = report.healthy ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
