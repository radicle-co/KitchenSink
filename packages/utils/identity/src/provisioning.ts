import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

// Generic over Drizzle's own table/column types — this package depends on NOTHING from any service's
// schema (no dependency cycle, no runtime edge). Callers inject their concrete tables; the result row
// type is the caller's via the `TUser` type parameter.

/** Drizzle handle. Callers pass `db as unknown as PostgresJsDatabase` per the repo cast convention. */
export type Db = PostgresJsDatabase<Record<string, never>>;

/** The `users` table must expose the columns the routine reads (conflict target + COALESCE sources). */
export interface UsersTableShape extends PgTable {
    readonly identityId: PgColumn;
    readonly name: PgColumn;
    readonly picture: PgColumn;
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
 * Deliberately NOT transactional: the three inserts are separate autocommit statements so locks release
 * per-statement. A transaction holding the users-row lock across the FK-checked aux inserts deadlocks
 * (40P01) against a concurrent autocommit webhook taking `FOR KEY SHARE` in the opposite order — the
 * exact webhook-vs-read-through race this targets (removed in `d59e11c`). The guarantee is idempotency
 * (the `users.identityId` unique index + per-aux `onConflictDoNothing`) plus heal-on-read, not atomicity.
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

    await ensureAccountAndProfile(deps, user.id, input);

    return { kind: 'complete', user };
}

async function upsertUser<TUser extends ProvisionedUser>(
    deps: ProvisionDeps,
    input: ProvisionInput,
    emailIsReal: boolean,
): Promise<TUser> {
    const { db, schema, newUserId } = deps;
    const now = new Date();

    const [row] = await db
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
            set: {
                // Overwrite email only when it's real (never clobber a concurrent webhook's real email
                // with a placeholder); COALESCE name/picture so a null incoming keeps the existing value.
                ...(emailIsReal ? { email: input.email } : {}),
                name: sql`coalesce(${input.name ?? null}, ${schema.users.name})`,
                picture: sql`coalesce(${input.picture ?? null}, ${schema.users.picture})`,
                // Revive a re-registered soft-deleted identity (matches the prior `upsertByIdentityId`
                // behavior; the read-through's old `upsertUserRecord` did NOT do this, so porting from it
                // without this line would silently leave a re-registered user soft-deleted-but-readable).
                deletedAt: null,
                updatedAt: now,
            },
        })
        .returning();

    return row as unknown as TUser;
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
