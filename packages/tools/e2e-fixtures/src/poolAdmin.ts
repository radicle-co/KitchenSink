/**
 * POOL ADMIN — provision the fixed Clerk test pool, out of band, and report drift.
 *
 * ## ⛔ The only writer
 *
 * This is the ONLY code in test tooling that creates a Clerk user or writes `public_metadata`
 * (`runtimeUserCreation.test.ts` and `metadataSingleWriter.test.ts` hold every other file to that). No test
 * run creates a user (owner ruling 2026-09-13); a run LEASES a slot this command provisioned, and the run fails
 * — it does not self-heal — when the slot is absent or unmarked, because a test that creates what it needs is
 * the shape this pool replaced.
 *
 * ## What it does
 *
 * For every roster slot: create the user if nobody holds the address (with the marker in the same call), or
 * merge-PATCH the marker, `permissions` and `scopes` if they have drifted. A consumed erasure slot is simply an
 * absent user, so replenishing is the same "create". Every user this run creates is then waited on until the
 * identity webhook has backfilled its `external_id`, because a slot without one answers 401 everywhere.
 *
 * ⛔ METADATA IS MERGED, NEVER REPLACED. `updateUser({ publicMetadata })` REPLACES the whole object — the
 * installed `@clerk/backend` marks that use deprecated for exactly this reason — so a second tool writing a
 * different key would silently erase the marker. `updateUserMetadata` deep-merges.
 *
 * DRIFT is any user carrying `testPrincipal: true` who holds no roster address. It is reported, never "fixed":
 * the services trust the marker (ADR-0040 containment and self-purge), so an unexplained holder is an alarm for a
 * human.
 *
 * ## Running it (owner only)
 *
 *   CLERK_SECRET_KEY=sk_test_… npx tsx packages/tools/e2e-fixtures/src/poolAdmin.ts            # dry run
 *   CLERK_SECRET_KEY=sk_test_… npx tsx packages/tools/e2e-fixtures/src/poolAdmin.ts --apply    # write
 *
 * The dry run is the default and writes nothing. Exit status is non-zero on drift, on an ambiguous slot, or
 * (dry run) when anything is left to do.
 *
 * ⚠️ SANDBOX TENANT ONLY in this phase — a non-development key is refused before a client is built.
 *
 * @pattern Command — one reconciliation, planned purely (`planPool`) and applied by an impure step that holds no policy
 * @pattern Port — `PoolAdminPort`, with `clerkPoolAdminPort` as the Clerk Backend API adapter
 */
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { createClerkClient } from '@clerk/backend';

import { withClerkBackendRetry } from './clerkSession.js';
import { awaitExternalId, EXTERNAL_ID_DEADLINE_MS, EXTERNAL_ID_POLL_MS } from './externalId.js';
import { POOL_PASSWORD, poolSlotMetadata, rosterSlots, type PoolSlot, type PoolSlotMetadata } from './testPool.js';

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
    /** Nothing ambiguous, no drift, and — on a dry run — nothing left to do. */
    readonly healthy: boolean;
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
 * Observe, plan, and — only with `apply` — write.
 *
 * Writes happen one at a time: the Backend API limit is instance-wide and shared with every suite running
 * against the dev instance.
 *
 * @sideEffect Reads every Clerk user; with `apply`, creates users and writes metadata, then polls for
 *   `external_id`.
 */
export async function reconcilePool(
    port: PoolAdminPort,
    options: {
        readonly apply: boolean;
        readonly slots?: readonly PoolSlot[];
        readonly randomPassword: () => string;
        readonly now: () => number;
        readonly sleep: (ms: number) => Promise<void>;
    },
): Promise<PoolReport> {
    const slots = options.slots ?? rosterSlots();
    const holders = new Map<string, readonly ObservedPoolUser[]>();

    for (const slot of slots) {
        holders.set(slot.email, await port.findUsers(slot.email));
    }

    const plan = planPool(slots, holders, await port.listUsers());
    const broken = plan.drift.length > 0 || plan.actions.some((action) => action.kind === 'ambiguous');
    const pending = plan.actions.some((action) => action.kind === 'create' || action.kind === 'mark');

    if (!options.apply) {
        return { plan, applied: false, healthy: !broken && !pending };
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

    return { plan, applied: true, healthy: !broken };
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
        `${report.applied ? 'applied' : 'dry run (pass --apply to write)'} — ${report.healthy ? 'healthy' : 'NOT healthy'}`,
    ];
}

/**
 * The CLI.
 *
 * @sideEffect Reads the environment, calls Clerk, writes to stdout/stderr, and sets the exit code.
 */
async function main(): Promise<void> {
    const secretKey = process.env['CLERK_SECRET_KEY'] ?? '';

    if (secretKey.trim() === '') {
        throw new Error('poolAdmin: CLERK_SECRET_KEY is required');
    }

    const report = await reconcilePool(clerkPoolAdminPort(secretKey), {
        apply: process.argv.slice(2).includes('--apply'),
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
