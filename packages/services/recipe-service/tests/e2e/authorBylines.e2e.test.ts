/**
 * The byline read model's two READ paths against a real Postgres (plan 2026-10-15-010 D7/D8; LOCAL e2e, §7.1a).
 *
 * ⛔ WHY THIS TIER. Both claims are properties of the database:
 *
 *   - **The write path's lock.** `AuthorHandlesDal.findByline` takes `FOR SHARE` inside the recipe write's
 *     transaction, so the handle-sync consumer's upsert of the same user WAITS for that write to commit — and its
 *     fan-out then reaches the new row. A mocked DAL cannot block anything, and `FOR SHARE` also needs the service
 *     role to hold UPDATE on the table, which only a real role model answers.
 *   - **The collection join.** A clone's source owner username is resolved at READ time through the source
 *     collection's owner; a deleted source yields none.
 *
 * Runs as `recipe_app`, the role the service holds.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../src/database/client.js';
import { AuthorHandlesDal } from '../../src/authors/dal/authorHandles.dal.js';
import { CollectionsDal } from '../../src/collections/dal/collections.dal.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const SOURCE_OWNER = '01JBYLINEE2E00SOURCEOWNER0';
const CLONER = '01JBYLINEE2E0000000CLONER0';
const NOBODY = '01JBYLINEE2E00000000NOBODY';

describe('the byline read model (real Postgres)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 4 });
        db = createRecipeDrizzle(pool);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM collections WHERE owner_id = ANY($1)', [[SOURCE_OWNER, CLONER]]);
        await pool.query('DELETE FROM author_handles WHERE user_id = ANY($1)', [[SOURCE_OWNER, CLONER, NOBODY]]);
        await pool.end();
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM collections WHERE owner_id = ANY($1)', [[SOURCE_OWNER, CLONER]]);
        await pool.query('DELETE FROM author_handles WHERE user_id = ANY($1)', [[SOURCE_OWNER, CLONER, NOBODY]]);
        await pool.query(
            `INSERT INTO author_handles (user_id, display_name, username, source_timestamp)
             VALUES ($1, 'Clara Oswald', 'clara', now())`,
            [SOURCE_OWNER],
        );
    });

    describe('AuthorHandlesDal.findByline', () => {
        it('answers both halves, or nothing for a cook it has never seen', async () => {
            const dal = new AuthorHandlesDal(db);

            expect(await dal.findByline(SOURCE_OWNER)).toEqual({ displayName: 'Clara Oswald', username: 'clara' });
            expect(await dal.findByline(NOBODY)).toBeUndefined();
        });

        it('⛔ inside a write’s transaction, holds off the consumer’s upsert of that cook until the write commits', async () => {
            const dal = new AuthorHandlesDal(db);
            const consumer = await pool.connect();
            let consumerResult = 'not attempted';

            try {
                await db.transaction(async (tx) => {
                    await dal.findByline(SOURCE_OWNER, tx);

                    // The handle-sync consumer's statement, bounded so a held lock shows up as a timeout.
                    await consumer.query('BEGIN');
                    await consumer.query("SET LOCAL lock_timeout = '200ms'");
                    consumerResult = await consumer
                        .query(
                            `UPDATE author_handles SET username = 'clara_new', source_timestamp = now()
                             WHERE user_id = $1`,
                            [SOURCE_OWNER],
                        )
                        .then(
                            () => 'applied',
                            (error: { code?: string }) => `blocked:${error.code ?? 'unknown'}`,
                        );
                    await consumer.query('ROLLBACK');
                });
            } finally {
                consumer.release();
            }

            // 55P03 = lock_not_available: the write's FOR SHARE made the upsert wait rather than slip past it.
            expect(consumerResult).toBe('blocked:55P03');
        });
    });

    describe('CollectionsDal.sourceOwnerUsernames', () => {
        async function collection(ownerId: string, name: string, sourceId: string | null = null): Promise<string> {
            const { rows } = await pool.query<{ id: string }>(
                `INSERT INTO collections (owner_id, name, visibility, source_collection_id, source_owner_handle)
                 VALUES ($1, $2, 'public', $3, $4) RETURNING id`,
                [ownerId, name, sourceId, sourceId === null ? null : 'Clara Oswald'],
            );

            return rows[0]!.id;
        }

        it('resolves the source owner’s CURRENT username through the source collection', async () => {
            const sourceId = await collection(SOURCE_OWNER, 'Weeknights');
            await collection(CLONER, 'Weeknights', sourceId);
            await pool.query(`UPDATE author_handles SET username = 'clara_now' WHERE user_id = $1`, [SOURCE_OWNER]);

            const usernames = await new CollectionsDal(db).sourceOwnerUsernames([sourceId]);

            expect([...usernames]).toEqual([[sourceId, 'clara_now']]);
        });

        it('answers nothing for a source that is gone, or whose owner has no username', async () => {
            const sourceId = await collection(SOURCE_OWNER, 'Weeknights');
            const dal = new CollectionsDal(db);

            await pool.query(`UPDATE author_handles SET username = NULL WHERE user_id = $1`, [SOURCE_OWNER]);
            expect((await dal.sourceOwnerUsernames([sourceId])).size).toBe(0);

            await pool.query('DELETE FROM collections WHERE id = $1', [sourceId]);
            expect((await dal.sourceOwnerUsernames([sourceId])).size).toBe(0);
        });
    });
});
