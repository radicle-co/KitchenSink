import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, ilike } from 'drizzle-orm';

import { users, DrizzleProvider } from '../database/index.js';
import type { AuthorizerContext } from '../auth/decorators/current-user.decorator.js';
import { createServiceLogger } from '../observability/sentry-logging.js';

// Authorization (the `admin:users` scope check) is enforced declaratively by `ScopesGuard` +
// `@RequireScopes('admin:users')` on `AdminController` — see that guard's JSDoc for the pattern. This
// service therefore no longer performs its own `assertAdmin` check; a request cannot reach these methods
// without having already satisfied the guard. `ctx: AuthorizerContext` is dropped from `listUsers` (its
// only prior use was the authz check the guard now owns) but KEPT on the other four methods for ACTOR
// identity — suspend/unsuspend log the acting admin's id for the audit trail, and impersonation also
// needs it in the session id and response contract. None of these remaining uses are authorization.
@Injectable()
export class AdminService {
    private readonly logger = createServiceLogger(AdminService.name);

    constructor(@Inject(DrizzleProvider) private readonly db: NodePgDatabase) {}

    async listUsers(filters: { email?: string; name?: string; sub?: string; limit?: number; offset?: number }) {
        const predicates = [
            filters.email ? ilike(users.email, `%${filters.email}%`) : undefined,
            filters.name ? ilike(users.name, `%${filters.name}%`) : undefined,
            filters.sub ? eq(users.id, filters.sub) : undefined,
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

    async suspendUser(
        targetSub: string,
        adminCtx: AuthorizerContext,
    ): Promise<{ sub: string; status: 'suspended'; suspendedAt: string }> {
        const [existing] = await this.db.select().from(users).where(eq(users.id, targetSub)).limit(1);

        if (!existing) {
            throw new NotFoundException(`User ${targetSub} not found`);
        }

        const now = new Date();
        await this.db.update(users).set({ status: 'suspended', updatedAt: now }).where(eq(users.id, targetSub));

        this.logger.warn('user suspended', { adminSub: adminCtx.userId, targetSub, id: existing.id });

        return { sub: targetSub, status: 'suspended', suspendedAt: now.toISOString() };
    }

    async unsuspendUser(
        targetSub: string,
        adminCtx: AuthorizerContext,
    ): Promise<{ sub: string; status: 'active'; unsuspendedAt: string }> {
        const [existing] = await this.db.select().from(users).where(eq(users.id, targetSub)).limit(1);

        if (!existing) {
            throw new NotFoundException(`User ${targetSub} not found`);
        }

        const now = new Date();
        await this.db.update(users).set({ status: 'active', updatedAt: now }).where(eq(users.id, targetSub));

        this.logger.warn('user unsuspended', { adminSub: adminCtx.userId, targetSub, id: existing.id });

        return { sub: targetSub, status: 'active', unsuspendedAt: now.toISOString() };
    }

    async startImpersonation(
        targetSub: string,
        adminCtx: AuthorizerContext,
    ): Promise<{ impersonatorSub: string; impersonatedSub: string; sessionId: string; startedAt: string }> {
        const [existing] = await this.db.select().from(users).where(eq(users.id, targetSub)).limit(1);

        if (!existing) {
            throw new NotFoundException(`User ${targetSub} not found`);
        }

        const sessionId = `imp-${adminCtx.userId}-${targetSub}-${Date.now()}`;
        const now = new Date();

        this.logger.warn('impersonation started', {
            impersonatorSub: adminCtx.userId,
            impersonatedSub: targetSub,
            sessionId,
        });

        return {
            impersonatorSub: adminCtx.userId,
            impersonatedSub: targetSub,
            sessionId,
            startedAt: now.toISOString(),
        };
    }

    async stopImpersonation(
        targetSub: string,
        adminCtx: AuthorizerContext,
    ): Promise<{ impersonatorSub: string; impersonatedSub: string; stoppedAt: string; message: string }> {
        const [existing] = await this.db.select().from(users).where(eq(users.id, targetSub)).limit(1);

        if (!existing) {
            throw new NotFoundException(`User ${targetSub} not found`);
        }

        const now = new Date();

        this.logger.warn('impersonation stopped', {
            impersonatorSub: adminCtx.userId,
            impersonatedSub: targetSub,
        });

        return {
            impersonatorSub: adminCtx.userId,
            impersonatedSub: targetSub,
            stoppedAt: now.toISOString(),
            message: 'Impersonation session ended',
        };
    }
}
