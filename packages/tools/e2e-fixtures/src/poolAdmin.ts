/**
 * POOL ADMIN — provision the fixed Clerk test pool, and report drift.
 *
 * ## ⛔ The only writer
 *
 * This is the ONLY code in test tooling that creates a Clerk user or writes `public_metadata`
 * (`runtimeUserCreation.test.ts` and `metadataSingleWriter.test.ts` hold every other file to that). A test LEASES a
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
 * `poolAdmin.ts --apply --maestro-erasure --shard N`, which reconciles ONLY the erasure subjects that shard may lease
 * (`maestroErasureSlots` — all of them for the erasure shard, none for any other). So a run now tops the pool up, but
 * only through this module, the single writer; the tests themselves still never create a user, and every other slot
 * is still provisioned only by the owner's full run. The reason: each real erasure destroys its subject, the flow
 * runs on every Maestro run and both platforms, and a pool replenished only by hand ran dry
 * (`all 5 consumable slots are consumed`, both platforms, 2026-10-08). This paragraph is the one statement of the
 * amendment; everything else cites it.
 *
 * ## What it does
 *
 * For every slot in scope: create the user if nobody holds the address (with the marker in the same call), or
 * merge-PATCH the marker, `permissions` and `scopes` if they have drifted. A consumed erasure slot is simply an
 * absent user, so replenishing is the same "create". Every user this run creates is then waited on until the
 * identity webhook has backfilled its `external_id`, because a slot without one answers 401 everywhere. Then every
 * slot in scope is READ AGAIN and judged by the lease's own rule (`judgePoolSlot`): healthy means the next lease of
 * any of them will succeed, not merely that the writes returned.
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

import { createClerkClient } from '@clerk/backend';

import { withClerkBackendRetry } from './clerkSession.js';
import { awaitExternalId, EXTERNAL_ID_DEADLINE_MS, EXTERNAL_ID_POLL_MS } from './externalId.js';
import { judgePoolSlot } from './leaseSession.js';
import {
    maestroErasureSlots,
    POOL_PASSWORD,
    poolSlotMetadata,
    rosterSlots,
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
}

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
    /** Nothing ambiguous, no drift, every slot leasable, and — on a dry run — nothing left to do. */
    readonly healthy: boolean;
}

/** Which slots one invocation reconciles. */
export type PoolScope =
    | { readonly kind: 'roster' }
    /** The 2026-10-08 refill: the erasure subjects one Maestro shard may lease (see this file's header). */
    | { readonly kind: 'maestroErasure'; readonly shard: number };

/** Whether a reconciliation lists the whole instance to report drift. */
export type DriftAudit = 'audit' | 'skip';

/** What a scope reconciles, and whether it audits drift. Pure. */
export function poolScopeOptions(scope: PoolScope): {
    readonly slots: readonly PoolSlot[];
    readonly drift: DriftAudit;
} {
    switch (scope.kind) {
        case 'roster':
            return { slots: rosterSlots(), drift: 'audit' };
        case 'maestroErasure':
            return { slots: maestroErasureSlots(scope.shard), drift: 'skip' };
    }
}

/** A parsed command line. */
export interface PoolAdminArgs {
    readonly apply: boolean;
    readonly scope: PoolScope;
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
            shard: { type: 'string' },
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
 * @throws On an unknown argument, a repeated `--shard`, or `--maestro-erasure` and `--shard` not given together.
 */
export function parsePoolAdminArgs(argv: readonly string[]): PoolAdminArgs {
    let parsed: ReturnType<typeof readPoolAdminArgv>;

    try {
        parsed = readPoolAdminArgv(argv);
    } catch (error) {
        throw new Error(`poolAdmin: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }

    const apply = parsed.values.apply === true;
    const erasure = parsed.values['maestro-erasure'] === true;
    const shard = parsed.values.shard;

    // `parseArgs` keeps the LAST of a repeated option; two shards named is a caller that has not decided which.
    if (parsed.tokens.filter((token) => token.kind === 'option' && token.name === 'shard').length > 1) {
        throw new Error('poolAdmin: --shard may be given once');
    }

    if (!erasure) {
        if (shard !== undefined) {
            throw new Error('poolAdmin: --shard scopes only a --maestro-erasure refill');
        }

        return { apply, scope: { kind: 'roster' } };
    }

    if (shard === undefined) {
        throw new Error('poolAdmin: --maestro-erasure needs --shard N, the Maestro shard whose subjects to refill');
    }

    // Digits only, anchored: `Number(' 1')` is 1, and every leniency is a scope nobody stated.
    if (!/^[0-9]+$/u.test(shard) || Number(shard) < 1) {
        throw new Error(`poolAdmin: --shard '${shard}' is not a positive integer`);
    }

    return { apply, scope: { kind: 'maestroErasure', shard: Number(shard) } };
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
        sameList(actual['permissions'], desired.permissions) &&
        sameList(actual['scopes'], desired.scopes)
    );
}

/**
 * Decide, purely, what the reconciliation does.
 *
 * @param slots - The roster slots to reconcile.
 * @param holders - For each slot address, the users holding it. A slot the map does not answer is ABSENT.
 * @param everyone - Every user on the instance, for drift.
 */
export function planPool(
    slots: readonly PoolSlot[],
    holders: ReadonlyMap<string, readonly ObservedPoolUser[]>,
    everyone: readonly ObservedPoolUser[],
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

        return metadataSatisfies(only.publicMetadata, poolSlotMetadata(slot))
            ? { kind: 'ok', slot, userId: only.id }
            : { kind: 'mark', slot, userId: only.id };
    });

    const roster = new Set(rosterSlots().map((slot) => slot.email));
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
        publicMetadata: poolSlotMetadata(slot),
    };
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
 * Observe, plan, and — only with `apply` — write.
 *
 * Writes happen one at a time: the Backend API limit is instance-wide and shared with every suite running
 * against the dev instance.
 *
 * @sideEffect Reads the slots in scope (and, auditing drift, every Clerk user); with `apply`, creates users and
 *   writes metadata, polls for `external_id`, then reads the slots in scope again.
 */
export async function reconcilePool(
    port: PoolAdminPort,
    options: {
        readonly apply: boolean;
        readonly slots?: readonly PoolSlot[];
        /** Required: whether drift is audited is a decision about cost and blast radius, never a default. */
        readonly drift: DriftAudit;
        readonly randomPassword: () => string;
        readonly now: () => number;
        readonly sleep: (ms: number) => Promise<void>;
    },
): Promise<PoolReport> {
    const slots = options.slots ?? rosterSlots();
    const holders = await observeSlots(port, slots);
    const plan = planPool(slots, holders, options.drift === 'audit' ? await port.listUsers() : []);
    const broken = plan.drift.length > 0 || plan.actions.some((action) => action.kind === 'ambiguous');
    const pending = plan.actions.some((action) => action.kind === 'create' || action.kind === 'mark');

    if (!options.apply) {
        const unleasable = unleasableSlots(slots, holders);

        return { plan, applied: false, unleasable, healthy: !broken && !pending && unleasable.length === 0 };
    }

    const created: { readonly slot: PoolSlot; readonly id: string }[] = [];

    for (const action of plan.actions) {
        if (action.kind === 'mark') {
            await port.mergeMetadata(action.userId, poolSlotMetadata(action.slot));
        } else if (action.kind === 'create') {
            const { id } = await port.createUser(poolUserCreateInput(action.slot, options.randomPassword()));
            created.push({ slot: action.slot, id });
        }
    }

    for (const { slot, id } of created) {
        await awaitExternalId(slot.email, {
            deadlineMs: EXTERNAL_ID_DEADLINE_MS,
            pollMs: EXTERNAL_ID_POLL_MS,
            read: () => port.readExternalId(id),
            now: options.now,
            sleep: options.sleep,
        });
    }

    // Judged on a FRESH read, never on the plan: a write that returned is not a slot a lease will accept.
    const unleasable = unleasableSlots(slots, await observeSlots(port, slots));

    return { plan, applied: true, unleasable, healthy: !broken && unleasable.length === 0 };
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
        readExternalId: async (userId) => (await backend(() => clerk.users.getUser(userId))).externalId,
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
        `${report.applied ? 'applied' : 'dry run (pass --apply to write)'} — ${report.healthy ? 'healthy' : 'NOT healthy'}`,
    ];
}

/**
 * The CLI.
 *
 * @sideEffect Reads the environment, calls Clerk, writes to stdout/stderr, and sets the exit code.
 */
async function main(): Promise<void> {
    const args = parsePoolAdminArgs(process.argv.slice(2));
    const secretKey = process.env['CLERK_SECRET_KEY'] ?? '';

    if (secretKey.trim() === '') {
        throw new Error('poolAdmin: CLERK_SECRET_KEY is required');
    }

    // Built FIRST, whatever the scope: it is what refuses a non-development key, and a refill that has nothing to
    // do must still refuse to hold a production one.
    const port = clerkPoolAdminPort(secretKey);
    const scoped = poolScopeOptions(args.scope);

    if (args.scope.kind === 'maestroErasure' && scoped.slots.length === 0) {
        console.log(`maestro shard ${args.scope.shard} leases no erasure subject — nothing to refill`);
    }

    const report = await reconcilePool(port, {
        apply: args.apply,
        ...scoped,
        randomPassword: () => `Pp1!${randomBytes(24).toString('base64url')}`,
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
