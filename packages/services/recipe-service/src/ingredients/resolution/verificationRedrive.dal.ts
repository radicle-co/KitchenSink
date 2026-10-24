/**
 * The producer's half of the pending re-drive substrate (plan U4c, migration 0037): ONE verb, the upsert.
 *
 * The READ half — "aged rows with no verdict, oldest first" — lives with the scheduled drain in
 * recipe-workers (`handlers/bandDrain.ts`), raw SQL over the accepted seam. Unlike the band state machine
 * there is no shared invariant between the halves beyond the table shape: this side writes rows, that side
 * marks attempts, and the verdict join uses the verdict store's own primary key with no derivation to drift.
 */
import { sql } from 'drizzle-orm';

import { verificationRedrive } from '../../database/schema/index.js';
import type { RecipeDrizzle } from '../../database/database.module.js';

export class VerificationRedriveDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Record (or refresh) a withholding line's ready message.
     *
     * `DO UPDATE` rather than `DO NOTHING`: a re-save of the same judgement carries the same key and a
     * possibly newer message rendering (e.g. a producer release changed an optional field) — the drain
     * should re-send the newest form. `created_at` is NOT reset, so the age bound measures from the FIRST
     * withholding, not the latest save.
     *
     * @param verificationKey - The verdict store's content key for this judgement.
     * @param message - The producer-built `VerifyIngredientLineMessage`, verbatim.
     * @sideEffect One UPSERT.
     */
    public async record(verificationKey: string, message: unknown): Promise<void> {
        await this.db
            .insert(verificationRedrive)
            .values({ verificationKey, message })
            .onConflictDoUpdate({
                target: verificationRedrive.verificationKey,
                set: { message: sql`excluded.message` },
            });
    }
}
