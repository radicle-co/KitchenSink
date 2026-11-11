/**
 * The seed's one direct database write: a `recipe_ingredient_verifications` row, in the LOCAL recipe database.
 *
 * ⛔ UNREACHABLE WITHOUT A PROOF OF LOCALITY. {@link openVerdictStore} takes a `LocalSeedTarget`, which only
 * `requireLocalSeedTarget` makes, from the host of the database URL (and of the recipe and food APIs). Nothing else in this
 * package opens a database connection.
 *
 * ⛔ IT TOUCHES ONLY ITS OWN ROWS. The row carries a `model_id` marker no worker writes, and the previous row is removed by
 * that marker, so clearing up after a run can never delete a verdict a worker wrote. A verdict is keyed by content and
 * outlives the recipe, so the row is replaced on the next `needsReview` reset, not when the recipe is deleted; a `seeded`
 * reset in between leaves it in place (harmless: no recipe line has its key).
 *
 * The connection is the local stack's own (`LOCAL_DB`: the container's maintenance login). It is never a role of the
 * deployed model (owner, migrator, service), so no role name is spelled here.
 *
 * @pattern Adapter over `pg`, behind the {@link SeedVerdictStore} port; the connection is a parameter so a unit test fakes it
 */
import pg from 'pg';

import type { LocalSeedTarget } from './localSeedTarget.js';
import { NEEDS_REVIEW_SEED_MODEL_ID, type SeedVerdictRow, type SeedVerdictStore } from './needsReviewProbe.js';

/** The two calls the store makes of a connection; `pg.Client` satisfies it. */
export interface VerdictConnection {
    readonly query: (sql: string, params?: readonly unknown[]) => Promise<unknown>;
    readonly end: () => Promise<void>;
}

const DELETE_SEED_ROWS = 'DELETE FROM recipe_ingredient_verifications WHERE model_id = $1';

const UPSERT_ROW = `INSERT INTO recipe_ingredient_verifications
    (verification_key, verdict, certainty, band, aspects, identity_verdict, quantity_verdict, model_id, food_id, food_variant_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (verification_key) DO UPDATE SET
        verdict = EXCLUDED.verdict, certainty = EXCLUDED.certainty, band = EXCLUDED.band, aspects = EXCLUDED.aspects,
        identity_verdict = EXCLUDED.identity_verdict, quantity_verdict = EXCLUDED.quantity_verdict,
        model_id = EXCLUDED.model_id, food_id = EXCLUDED.food_id, food_variant_id = EXCLUDED.food_variant_id,
        verified_at = now()`;

/**
 * A store over any connection factory.
 *
 * @param connect - Opens one connection per write.
 * @returns The store.
 */
export function createVerdictStore(connect: () => Promise<VerdictConnection>): SeedVerdictStore {
    return {
        replaceSeedVerdict: async (row: SeedVerdictRow): Promise<void> => {
            const connection = await connect();

            try {
                await connection.query('BEGIN');
                await connection.query(DELETE_SEED_ROWS, [NEEDS_REVIEW_SEED_MODEL_ID]);
                await connection.query(UPSERT_ROW, [
                    row.verificationKey,
                    row.verdict,
                    row.certainty,
                    row.band,
                    row.aspects,
                    row.identityVerdict,
                    row.quantityVerdict,
                    row.modelId,
                    row.foodId,
                    row.foodVariantId,
                ]);
                await connection.query('COMMIT');
            } catch (error) {
                await connection.query('ROLLBACK');
                throw error;
            } finally {
                await connection.end();
            }
        },
    };
}

/**
 * The store over the local recipe database.
 *
 * @param target - The proof the database is local.
 * @returns The store.
 * @sideEffect Each write opens and closes one connection to the recipe database.
 */
export function openVerdictStore(target: LocalSeedTarget): SeedVerdictStore {
    return createVerdictStore(async () => {
        const client = new pg.Client({ connectionString: target.databaseUrl });
        await client.connect();

        return client;
    });
}
