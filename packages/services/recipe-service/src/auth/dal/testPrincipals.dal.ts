/**
 * The test-principal REGISTRY data-access layer (ADR-0040, migration 0044).
 *
 * @pattern Read Model — like `author_handles`, a projection of a signed claim into a table SQL can join on. It is
 *   written from the claim (`AuthMiddleware`) and read by the two places that act with no claim of their own to
 *   hand: the self-purge's registry check — which is written from the claim, so it is NOT an independent witness
 *   (ADR-0040 §4) — and nothing else at request time.
 *
 * Identity-blind, like every DAL here: it takes an app-user ULID and answers about rows.
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DrizzleProvider, type RecipeDrizzle } from '../../database/database.module.js';
import { testPrincipals } from '../../database/schema/testPrincipals.js';

@Injectable()
export class TestPrincipalsDal {
    public constructor(@Inject(DrizzleProvider) private readonly db: RecipeDrizzle) {}

    /**
     * Record that this app-user ULID presented the signed test-principal claim. Idempotent: an id already registered
     * is a no-op, because every process start re-registers the pool.
     *
     * @param userId - The verified app-user ULID of a signed test principal.
     * @sideEffect Inserts at most one `test_principals` row.
     */
    public async register(userId: string): Promise<void> {
        await this.db.insert(testPrincipals).values({ userId }).onConflictDoNothing({ target: testPrincipals.userId });
    }

    /**
     * Whether this app-user ULID is in the registry.
     *
     * @param userId - The app-user ULID to look up.
     * @returns `true` when a registry row exists.
     * @sideEffect Reads `test_principals`.
     */
    public async isRegistered(userId: string): Promise<boolean> {
        const rows = await this.db
            .select({ userId: testPrincipals.userId })
            .from(testPrincipals)
            .where(eq(testPrincipals.userId, userId))
            .limit(1);

        return rows.length > 0;
    }
}
