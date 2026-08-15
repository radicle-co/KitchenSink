import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

// Generic over Drizzle's own table/column types — this package depends on NOTHING from any service's
// schema (no dependency cycle, no runtime edge). Callers inject their concrete tables; the result row
// type is the caller's via the `TUser` type parameter.

/** Drizzle handle. Callers pass `db as unknown as PostgresJsDatabase` per the repo cast convention. */
export type Db = PostgresJsDatabase<Record<string, never>>;

/**
 * The `users` table must expose the columns the routine reads: the conflict target (`identityId`), the
 * COALESCE sources (`name`/`picture`), and the lifecycle columns the R10 no-resurrection guard references in
 * its `case` expressions (`status`/`deletedAt`/`email`).
 */
export interface UsersTableShape extends PgTable {
    readonly identityId: PgColumn;
    readonly name: PgColumn;
    readonly picture: PgColumn;
    readonly status: PgColumn;
    readonly deletedAt: PgColumn;
    readonly email: PgColumn;
    readonly updatedAt: PgColumn;
}

/** The Drizzle table objects, injected so this package never imports a service schema (KTD2). */
export interface ProvisioningSchema {
    readonly users: UsersTableShape;
    readonly accounts: PgTable;
    readonly profiles: PgTable;
}

export interface ProvisionDeps {
    readonly db: Db;
    readonly schema: ProvisioningSchema;
    /** ULID generator — callers inject their branded `newUserId`. */
    readonly newUserId: () => string;
}

export interface ProvisionInput {
    readonly identityId: string;
    readonly email: string;
    readonly name?: string | null;
    readonly picture?: string | null;
    /** Profile display name; defaults to `name ?? ''`. */
    readonly displayName?: string | null;
    readonly avatarUrl?: string | null;
}

/**
 * What to do when `email` already belongs to a DIFFERENT active identity (`users_email_unique`):
 * - `placeholder` — retry with a per-identity placeholder email so this user is still provisioned
 *   complete (read-through; also reconciliation, the last-resort backstop).
 * - `signal-incomplete` — return without provisioning and let another path handle it (the webhook,
 *   which knows the read-through will provision the user on first authenticated request).
 */
export type EmailCollisionPolicy = 'placeholder' | 'signal-incomplete';

export interface ProvisionOpts {
    readonly onEmailCollision: EmailCollisionPolicy;
    /**
     * `false` ⇒ never overwrite an existing email on conflict — a read-through placeholder must not
     * clobber a real email a concurrent webhook just wrote. Default `true`.
     */
    readonly emailIsReal?: boolean;
}

/** Minimal user-row shape the routine guarantees in a `complete` result (callers narrow via `TUser`). */
export interface ProvisionedUser {
    readonly id: string;
    readonly email: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    /** The lifecycle state — the R10 guard reads it to refuse companion-row rebuild for a closed/erased user. */
    readonly status: string;
}

/**
 * Lifecycle states whose row must NEVER be resurrected by provisioning (R10): a closed (`tombstoned`) or erased
 * (`erased`) account. A sign-in read-through or the nightly reconciliation MUST NOT clear `deletedAt`, restore
 * name/avatar, or rebuild the companion `accounts`/`profiles` rows for such a user.
 */
const NON_REVIVABLE_STATES = ['tombstoned', 'erased'] as const;

/** True when a row's lifecycle state forbids resurrection (tombstoned/erased). */
function isNonRevivable(status: string): boolean {
    return (NON_REVIVABLE_STATES as readonly string[]).includes(status);
}

export type ProvisionResult<TUser extends ProvisionedUser = ProvisionedUser> =
    | { readonly kind: 'complete'; readonly user: TUser }
    | { readonly kind: 'incomplete'; readonly reason: 'email-collision' };

/** Per-identity, never-deliverable placeholder for users whose token carries no usable email. */
const placeholderEmail = (identityId: string): string => `${identityId}@no-email.invalid`;

/**
 * Postgres unique-violation (23505) on `users_email_unique`. Drizzle wraps the driver error, so the
 * pg error (carrying `code`/`constraint`) lives on a possibly-nested `.cause` — walk the chain.
 */
function isEmailUniqueViolation(err: unknown): boolean {
    let current: unknown = err;

    for (let depth = 0; current !== null && current !== undefined && depth < 5; depth++) {
        const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };

        if (e.code === '23505' && e.constraint === 'users_email_unique') {
            return true;
        }

        current = e.cause;
    }

    return false;
}

/**
 * THE single definition of "a complete user". Idempotently upsert the `users` row (keyed on the Clerk
 * identity id) and ensure its companion `accounts` + `profiles` rows — as one unit, callable from every
 * provisioning path (read-through, webhook, reconciliation). No path may write a bare `users` row.
 *
 * THE AUX INSERTS ARE STILL NOT IN A TRANSACTION WITH THE UPSERT, and that part must stay. A transaction
 * holding the users-row lock across the FK-checked `accounts`/`profiles` inserts deadlocks (40P01) against a
 * concurrent autocommit writer taking `FOR KEY SHARE` on the same row in the opposite order — the
 * webhook-vs-read-through race removed in `d59e11c`. The guarantee is idempotency (the `users.identityId`
 * unique index + per-aux `onConflictDoNothing`) plus heal-on-read, not atomicity.
 *
 * The USERS UPSERT ALONE is serialized per identity — see {@link upsertUser}. That is a different deadlock
 * with a different cause, and the two fixes are not in tension: `d59e11c` was about the SPAN of a
 * transaction, this is about two concurrent sessions inside one statement's speculative insertion.
 *
 * @sideEffect upserts the `users` row and inserts the `accounts` + `profiles` rows.
 * @implements REQ-013 REQ-014 REQ-015 REQ-017 FR-013 FR-014 FR-015 FR-017 ARCH-011 ARCH-012 ARCH-015 MOD-011 MOD-012 MOD-015
 */
export async function provisionCompleteUser<TUser extends ProvisionedUser = ProvisionedUser>(
    deps: ProvisionDeps,
    input: ProvisionInput,
    opts: ProvisionOpts,
): Promise<ProvisionResult<TUser>> {
    const emailIsReal = opts.emailIsReal ?? true;

    let user: TUser;

    try {
        user = await upsertUser<TUser>(deps, input, emailIsReal);
    } catch (err) {
        if (!isEmailUniqueViolation(err)) {
            throw err;
        }

        if (opts.onEmailCollision === 'signal-incomplete') {
            return { kind: 'incomplete', reason: 'email-collision' };
        }

        // `placeholder`: the email belongs to another active identity. Re-provision this identity with
        // a per-identity placeholder (keyed on the sub, so it can only conflict on identityId — handled
        // by the upsert — never on the email index) and never overwrite a real email.
        user = await upsertUser<TUser>(deps, { ...input, email: placeholderEmail(input.identityId) }, false);
    }

    // R10 (anti-resurrection): a closed/erased account's row survives (never hard-deleted) but its companion
    // rows were scrubbed away. The lifecycle-aware upsert above already preserved the tombstoned/erased row's
    // deletedAt/name/picture; here we STOP before ensureAccountAndProfile so a sign-in read-through or the
    // nightly reconciliation cannot silently rebuild the account/profile it deliberately removed.
    if (isNonRevivable(user.status)) {
        return { kind: 'complete', user };
    }

    await ensureAccountAndProfile(deps, user.id, input);

    return { kind: 'complete', user };
}

/**
 * Advisory-lock namespace (the first key of the two-argument `pg_advisory_xact_lock`), so this lock can never
 * collide with an advisory lock some other feature takes on a coincidentally equal hash. Arbitrary but fixed.
 *
 * EXPORTED so `provisioningRace.integration.test.ts` can hold the very same lock and assert that provisioning
 * BLOCKS behind it. That makes the serialization guarantee deterministically testable rather than only
 * observable as the absence of a racy deadlock — and it means deleting the lock breaks the test's import
 * instead of quietly leaving a green suite.
 */
export const PROVISION_LOCK_NAMESPACE = 5310;

/**
 * Idempotently upsert the `users` row, keyed on the Clerk identity id, SERIALIZED PER IDENTITY.
 *
 * ## Why the advisory lock exists (40P01, `users_email_unique`)
 *
 * `INSERT … ON CONFLICT (identity_id) DO UPDATE` is not a single atomic index operation. Postgres performs a
 * SPECULATIVE INSERTION: it writes the heap tuple, takes a speculative token, and then inserts an index tuple
 * into EVERY unique index on the table one at a time. `users` has two that matter here — the `identity_id`
 * arbiter and `users_email_unique` — and the three provisioning paths (read-through, webhook, reconciliation)
 * all write the SAME identity with the SAME email on a sign-up burst. That produces a genuine lock cycle:
 *
 *   - session A wins the email index tuple and then hits the `identity_id` conflict from session C, so it
 *     enters the `DO UPDATE` arm and waits on C's TRANSACTION;
 *   - session B, inserting the same email, waits on A's SPECULATIVE TOKEN for `users_email_unique`;
 *   - C waits on B. Cycle → `40P01 deadlock detected … while inserting index tuple in relation
 *     users_email_unique`.
 *
 * Reproduced against a real PostgreSQL 16 by widening the integration test's concurrency from 3 to 8: 2
 * deadlocks in 40 iterations, with the identical `waits for ShareLock on speculative token` detail CI reported.
 * It is NOT test-only — read-through provisioning runs on the authentication hot path (first request per user),
 * so a real signup burst hits it and the caller gets a 500.
 *
 * ## Why an advisory lock, and not the alternatives
 *
 * A transaction-scoped advisory lock keyed on the identity is taken BEFORE the statement, so two sessions
 * provisioning the same identity can never be inside speculative insertion at the same time — the cycle cannot
 * form rather than being retried out of. It is the minimum that works:
 *
 *  - **Retrying on 40P01** treats a predictable, reproducible cycle as bad luck, and pays for it with latency
 *    on the auth hot path plus a partially-rolled-back provision (CI also logged an `accounts_user_id_fkey`
 *    violation from exactly that).
 *  - **Dropping/loosening `users_email_unique`** removes the constraint that makes "one active user per email"
 *    true, to fix a locking artefact.
 *  - **Wrapping the whole routine in a transaction** is the `d59e11c` deadlock, from the opposite direction.
 *
 * The lock is held for ONE statement and released at commit. It does not span the aux inserts, so it cannot
 * reintroduce `d59e11c`; and because it is acquired before any row lock, this transaction never waits on a row
 * while holding one.
 *
 * `hashtext` maps the identity to the lock's second key. A hash COLLISION is harmless by construction: two
 * unrelated identities would merely serialize against each other for one statement, which costs a little
 * concurrency and can never produce a wrong result — so the function's stability across major versions is not
 * a correctness dependency.
 *
 * @param deps - Injected db handle, tables, and id generator.
 * @param input - The identity/email/name to provision.
 * @param emailIsReal - `false` ⇒ never overwrite an existing email (a placeholder retry).
 * @returns The upserted user row.
 * @sideEffect Opens a short transaction, takes an advisory lock, and upserts the `users` row.
 */
async function upsertUser<TUser extends ProvisionedUser>(
    deps: ProvisionDeps,
    input: ProvisionInput,
    emailIsReal: boolean,
): Promise<TUser> {
    const { db, schema, newUserId } = deps;
    const now = new Date();

    return db.transaction(async (tx) => {
        // Both keys are cast explicitly: bound parameters otherwise leave Postgres unable to choose between
        // the `(bigint)` and `(int4, int4)` overloads of pg_advisory_xact_lock.
        await tx.execute(
            sql`select pg_advisory_xact_lock(${PROVISION_LOCK_NAMESPACE}::int4, hashtext(${input.identityId}::text))`,
        );

        const [row] = await tx
            .insert(schema.users)
            .values({
                id: newUserId(),
                identityId: input.identityId,
                email: input.email,
                name: input.name ?? null,
                picture: input.picture ?? null,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: schema.users.identityId,
                // R10 (anti-resurrection): every mutated column is guarded by a `case` on the EXISTING row's
                // status. For a `tombstoned`/`erased` row each column resolves to its own current value — a
                // total no-op update — so a sign-in read-through OR the nightly reconciliation can never clear
                // deletedAt, restore name/avatar, revive the email, or even bump updatedAt for a closed/erased
                // account. For every other row the behaviour is unchanged: overwrite email only when real;
                // COALESCE name/picture (a null incoming keeps the existing value); clear deletedAt (revive a
                // re-registered soft-deleted identity); bump updatedAt.
                set: {
                    ...(emailIsReal
                        ? {
                              email: sql`case when ${schema.users.status} in ('tombstoned', 'erased') then ${schema.users.email} else ${input.email} end`,
                          }
                        : {}),
                    name: sql`case when ${schema.users.status} in ('tombstoned', 'erased') then ${schema.users.name} else coalesce(${input.name ?? null}, ${schema.users.name}) end`,
                    picture: sql`case when ${schema.users.status} in ('tombstoned', 'erased') then ${schema.users.picture} else coalesce(${input.picture ?? null}, ${schema.users.picture}) end`,
                    deletedAt: sql`case when ${schema.users.status} in ('tombstoned', 'erased') then ${schema.users.deletedAt} else null end`,
                    updatedAt: sql`case when ${schema.users.status} in ('tombstoned', 'erased') then ${schema.users.updatedAt} else ${now} end`,
                },
            })
            .returning();

        return row as unknown as TUser;
    });
}

/** Idempotently ensure the account + profile rows. No-op once present (`onConflictDoNothing`). */
async function ensureAccountAndProfile(deps: ProvisionDeps, userId: string, input: ProvisionInput): Promise<void> {
    const { db, schema } = deps;

    await db.insert(schema.accounts).values({ userId }).onConflictDoNothing();
    await db
        .insert(schema.profiles)
        .values({ userId, displayName: input.displayName ?? input.name ?? '', avatarUrl: input.avatarUrl ?? null })
        .onConflictDoNothing();
}
