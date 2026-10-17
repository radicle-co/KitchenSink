/**
 * The `author_handles` read-model DAL (W8-a.2 / owner decision 6) — the recipe DB's local view of a user's byline:
 * the display name and the Clerk username identity last published. Recipe writes read it LOCALLY, with NO
 * cross-service call (the rejected read-time-lookup alternative), falling back to the token claim only when no row
 * exists yet (`authors/domain/bylinePolicy.ts`).
 *
 * The read model's only WRITER is the handle-sync consumer, `recipe-workers`' `applyHandleRename`. A second copy of
 * that rule used to live here with no production caller; it was deleted rather than kept in step.
 *
 * @pattern Read Model — a projection of identity's profile, maintained by the handle-sync consumer
 * @sideEffect Every method reads Postgres via the injected Drizzle client.
 */
import { eq } from 'drizzle-orm';

import type { RecipeDrizzle } from '../../database/client.js';
import { authorHandles } from '../../database/schema/index.js';
import type { RecipeTx } from '../../database/unitOfWork.js';
import type { BylineReadModel } from '../domain/bylinePolicy.js';

export class AuthorHandlesDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * The user's byline from the read model, or `undefined` when no snapshot has been applied yet.
     *
     * ⛔ Pass the write's transaction. The read takes `FOR SHARE` on the row, so the handle-sync consumer's upsert of
     * the same user either waits for this write to commit — and its fan-out then reaches the row this write made — or
     * committed first and is read here. Without the lock, a snapshot landing between this read and the write's commit
     * would fan out to rows that do not include the new one, and that row would keep the old byline.
     *
     * @param userId - The app-user ULID.
     * @param executor - The write's transaction; the shared client for a read outside one.
     * @sideEffect Reads `author_handles` (and row-locks it `FOR SHARE` inside a transaction).
     */
    public async findByline(
        userId: string,
        executor: RecipeTx | RecipeDrizzle = this.db,
    ): Promise<BylineReadModel | undefined> {
        const [row] = await executor
            .select({ displayName: authorHandles.displayName, username: authorHandles.username })
            .from(authorHandles)
            .where(eq(authorHandles.userId, userId))
            .limit(1)
            .for('share');

        return row;
    }
}
