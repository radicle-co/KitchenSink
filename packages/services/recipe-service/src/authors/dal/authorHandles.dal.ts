/**
 * The `author_handles` read-model DAL (W8-a.2 / owner decision 6) — the recipe DB's local view of a user's
 * byline. The write path asks "what is this user's current handle?" LOCALLY, with NO cross-service call (the
 * rejected read-time-lookup alternative), falling back to the token claim only when no row exists yet.
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

export class AuthorHandlesDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * The user's current display name from the read model, or `undefined` when no rename has been seen yet
     * (the write path then falls back to `deriveDisplayName(claims)`).
     *
     * @sideEffect Reads `author_handles`.
     */
    public async findHandle(userId: string): Promise<string | undefined> {
        const [row] = await this.db
            .select({ displayName: authorHandles.displayName })
            .from(authorHandles)
            .where(eq(authorHandles.userId, userId))
            .limit(1);

        return row?.displayName;
    }
}
