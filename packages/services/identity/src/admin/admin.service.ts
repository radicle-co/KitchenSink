import { Inject, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, ilike, sql } from 'drizzle-orm';

import { isUserId, lifecycleEvents, users, type UserId } from '@kitchensink/identity-db';
import { DrizzleProvider } from '../database/database.module.js';
import { containsPattern } from '../common/likePattern.js';
import type { AuthorizerContext } from '../auth/decorators/currentUser.decorator.js';
import { SqsService } from '../queue/sqs.service.js';
import { createServiceLogger } from '@kitchensink/service-logging';
import { reportDeletionEnqueueFailure } from '../queue/deletionEnqueue.error.js';

/**
 * The caller-named user as a {@link UserId}, or `404`. The controller has already checked the SHAPE of a path
 * parameter (`adminUserIdParamSchema`); this narrows the type at the one boundary where a plain string meets
 * `users.id`, and answers a string that is no user id exactly as the service answers an unknown one.
 *
 * @param raw - The id the admin named.
 * @returns The id, branded.
 * @throws NotFoundException when `raw` is not a well-formed user id.
 */
function userIdOrNotFound(raw: string): UserId {
    if (!isUserId(raw)) {
        throw new NotFoundException(`User ${raw} not found`);
    }

    return raw;
}

// Authorization (the `admin:users` scope check) is enforced declaratively by `ScopesGuard` +
// `@RequireScopes('admin:users')` on `AdminController` — see that guard's JSDoc for the pattern. This
// service therefore no longer performs its own `assertAdmin` check; a request cannot reach these methods
// without having already satisfied the guard. `ctx: AuthorizerContext` is dropped from `listUsers` (its
// only prior use was the authz check the guard now owns) but KEPT on the other three methods for ACTOR
// identity — suspend/unsuspend/reactivate log the acting admin's id for the audit trail. None of these
// remaining uses are authorization.
@Injectable()
export class AdminService {
    private readonly logger = createServiceLogger(AdminService.name);

    constructor(
        @Inject(DrizzleProvider) private readonly db: NodePgDatabase,
        private readonly sqs: SqsService,
    ) {}

    /**
     * The target user's row, or a 404 when no user has that id.
     *
     * @param targetSub - The target user's id.
     * @returns The user's row.
     * @throws NotFoundException when no user has that id.
     * @sideEffect Reads the `users` table.
     */
    private async requireUser(targetSub: string): Promise<typeof users.$inferSelect> {
        const targetId = userIdOrNotFound(targetSub);
        const [existing] = await this.db.select().from(users).where(eq(users.id, targetId)).limit(1);

        if (!existing) {
            throw new NotFoundException(`User ${targetSub} not found`);
        }

        return existing;
    }

    async listUsers(filters: { email?: string; name?: string; sub?: string; limit?: number; offset?: number }) {
        // `containsPattern`, not a template literal: `%` and `_` in the caller's filter are ILIKE SYNTAX, and
        // they live inside the bound parameter's value where parameterisation cannot help. `?email=%` used to
        // build `ILIKE '%%%'` — the filter silently became "match every user" — and `?email=a_b` over-matched
        // addresses that do not contain `a_b`. See `common/likePattern.ts`.
        const predicates = [
            filters.email ? ilike(users.email, containsPattern(filters.email)) : undefined,
            filters.name ? ilike(users.name, containsPattern(filters.name)) : undefined,
            // A `sub` that is no user id matches no user: the filter must stay on and match nothing, not fall away.
            filters.sub ? (isUserId(filters.sub) ? eq(users.id, filters.sub) : sql`false`) : undefined,
        ].filter((predicate) => predicate !== undefined);

        const query = this.db
            .select({
                sub: users.id,
                email: users.email,
                name: users.name,
                picture: users.picture,
                status: users.status,
            })
            .from(users)
            .$dynamic();

        if (predicates.length > 0) {
            query.where(and(...predicates));
        }

        const limit = filters.limit ?? 50;
        const offset = filters.offset ?? 0;
        const rows = await query.limit(limit).offset(offset);

        return { users: rows, limit, offset };
    }

    /**
     * Move a user from `from` to a new status, only if the row still holds `from`, then wake the deletion worker.
     *
     * The status was read and checked before this write, so the check alone cannot stop an erasure that commits in
     * between from being turned back into `suspended` or `active`. The expected prior status is in the WHERE.
     *
     * ⛔ ADR-0081: suspension is a PROVIDER state. The deletion worker writes the `public_metadata.suspended` mark that
     * every service refuses at the shared verifier, and clears it on unsuspend. So the status INTENT advances in the
     * same statement as the status (compare-and-set against a stale worker, exactly as closure and reactivation do),
     * and the worker is handed a trigger. This REVERSES the earlier "no `status_version` bump": its reason was that
     * nothing would ever settle an advanced intent, and the worker now does. The `reactivation` event name is
     * historical; the worker reads the database and converges, whatever the name (U10).
     *
     * @throws ConflictException when no row held `from` any more.
     * @sideEffect updates the `users` row and enqueues a provider-convergence trigger.
     */
    private async transition(
        user: { id: UserId; identityId: string },
        from: 'active' | 'suspended',
        set: { status: 'active' | 'suspended'; updatedAt: Date },
    ): Promise<void> {
        const updated = await this.db
            .update(users)
            .set({ ...set, statusVersion: sql`${users.statusVersion} + 1` })
            .where(and(eq(users.id, user.id), eq(users.status, from)))
            .returning({ id: users.id });

        if (updated.length === 0) {
            throw new ConflictException(
                `User ${user.id} is no longer '${from}'; the status changed during the request`,
            );
        }

        try {
            await this.sqs.enqueueDeletion({ identityId: user.identityId, userId: user.id, event: 'reactivation' });
        } catch (err) {
            // ⛔ NOT a `warn`: the status is committed, so the database says suspended (or active) while the token mark
            // still says the old thing. The ONE paging path in `deletionEnqueue.error.ts`. The lost message is not gone for
            // good: the intent stays unapplied, `queueCheck` reports it, and the nightly erasure-reconciliation run
            // re-sends the trigger (`convergenceRedrive.ts`). The queue check itself only reads.
            reportDeletionEnqueueFailure({
                event: 'reactivation',
                userId: user.id,
                identityId: user.identityId,
                error: err,
            });
        }
    }

    async suspendUser(
        targetSub: string,
        adminCtx: AuthorizerContext,
    ): Promise<{ sub: string; status: 'suspended'; suspendedAt: string }> {
        const existing = await this.requireUser(targetSub);

        if (existing.status !== 'active') {
            // Suspending a closed or erased row would overwrite it out of R10's non-revivable states.
            throw new ConflictException(
                `User ${targetSub} is '${existing.status}', not 'active'; only an active account can be suspended`,
            );
        }

        const now = new Date();
        await this.transition(existing, 'active', { status: 'suspended', updatedAt: now });

        this.logger.warn('user suspended', { adminSub: adminCtx.userId, targetSub, id: existing.id });

        return { sub: targetSub, status: 'suspended', suspendedAt: now.toISOString() };
    }

    async unsuspendUser(
        targetSub: string,
        adminCtx: AuthorizerContext,
    ): Promise<{ sub: string; status: 'active'; unsuspendedAt: string }> {
        const existing = await this.requireUser(targetSub);

        if (existing.status !== 'suspended') {
            throw new ConflictException(
                `User ${targetSub} is '${existing.status}', not 'suspended'; only a suspended account can be unsuspended`,
            );
        }

        const now = new Date();
        await this.transition(existing, 'suspended', { status: 'active', updatedAt: now });

        this.logger.warn('user unsuspended', { adminSub: adminCtx.userId, targetSub, id: existing.id });

        return { sub: targetSub, status: 'active', unsuspendedAt: now.toISOString() };
    }

    /**
     * Admin-mediated recovery of a CLOSED (tombstoned) account (CR-002 U2). Self-service recovery is not
     * buildable — `@clerk/backend` has no server-side sign-in-attempt verification, and a banned user can't
     * sign in to be verified — so a support agent verifies the owner out-of-band and calls this.
     *
     * Clears the tombstone (status→active, deletedAt→null) and writes the R8 audit row in ONE transaction,
     * then enqueues a `reactivation` event so the deletion-worker performs the Clerk `unbanUser` (this
     * public-ALB service holds no Clerk secret). `erased` accounts are irreversible and rejected.
     *
     * @sideEffect updates the user, writes an audit row, and enqueues an unban.
     */
    async reactivateUser(
        targetSub: string,
        adminCtx: AuthorizerContext,
    ): Promise<{ sub: string; status: 'active'; reactivatedAt: string }> {
        const existing = await this.requireUser(targetSub);

        if (existing.status !== 'tombstoned') {
            // Only a closed (tombstoned) account is recoverable: an `active` user is not closed, and an
            // `erased`/`suspended` account is out of this flow (erased is irreversible by design).
            throw new ConflictException(
                `User ${targetSub} is '${existing.status}', not 'tombstoned'; only a closed account can be reactivated`,
            );
        }

        const now = new Date();

        await this.db.transaction(async (tx) => {
            await tx
                .update(users)
                .set({
                    status: 'active',
                    deletedAt: null,
                    updatedAt: now,
                    statusVersion: sql`${users.statusVersion} + 1`,
                })
                .where(eq(users.id, existing.id));

            await tx.insert(lifecycleEvents).values({
                userId: existing.id,
                event: 'reactivation',
                triggerSource: 'admin',
                actor: adminCtx.userId,
                occurredAt: now,
            });
        });

        // Hand the Clerk unban to the deletion-worker; the sub survived the ban, so the same ULID resolves.
        try {
            await this.sqs.enqueueDeletion({
                identityId: existing.identityId,
                userId: existing.id,
                event: 'reactivation',
            });
        } catch (err) {
            // ⛔ NOT a `warn`. The tombstone is already cleared and committed, so the database says `active`
            // while Clerk still has the identity BANNED — the recovered user stays locked out, and the support
            // agent who called this was told it worked. Announced through the ONE paging path in
            // `deletionEnqueue.error.ts`.
            reportDeletionEnqueueFailure({
                event: 'reactivation',
                userId: existing.id,
                identityId: existing.identityId,
                error: err,
            });
        }

        this.logger.warn('user reactivated', { adminSub: adminCtx.userId, targetSub, id: existing.id });

        return { sub: targetSub, status: 'active', reactivatedAt: now.toISOString() };
    }
}
