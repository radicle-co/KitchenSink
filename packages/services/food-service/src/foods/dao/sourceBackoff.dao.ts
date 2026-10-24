/**
 * `SourceBackoffDao` — the block ledger (ADR-0053 §5, migration `0019`). A 429, a 5xx outage or a low publisher quota
 * writes one row per source, and admission reads it under the limiter's lock, so one task's 429 stops every task.
 *
 * The write takes no advisory lock: it is one upsert, and the row lock `ON CONFLICT` takes is enough to keep the
 * later end. The end is computed by the database clock, the same clock admission compares it with, so no process
 * clock decides a block.
 *
 * The write runs after the source answered and ignores the caller's abort signal, so it bounds itself: one transaction
 * whose upsert gives up on the row lock at {@link RECORD_LOCK_TIMEOUT_MS}, and whose upsert and `COMMIT` each end by
 * {@link RECORD_STATEMENT_TIMEOUT_MS} (the statements before them only set those bounds and read no table). The bound they add up to is stated, and tested, in `sourceCallLog.dao.ts`.
 *
 * @pattern Repository — the one writer of `source_backoff`, implementing the transport's `BlockLedger` port
 * @implements FR-026
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { localTimeout } from '../../database/localTimeout.js';
import type { BlockLedger, SourceBlock } from '../../sources/transport/transportPorts.js';

/** How long the write waits for another writer's lock on the source's row, in milliseconds. */
export const RECORD_LOCK_TIMEOUT_MS = 1_000;

/**
 * The longest any one statement of the write may run, its lock wait included, in milliseconds. Longer than
 * {@link RECORD_LOCK_TIMEOUT_MS}, so a held lock fails as a lock failure (55P03), not a cancelled statement.
 */
export const RECORD_STATEMENT_TIMEOUT_MS = 2_000;

/** The statements the write runs under `statement_timeout`: the upsert and `COMMIT`. The e2e suite counts them. */
export const RECORD_TIMED_STATEMENTS = 2;

const LOCK_TIMEOUT = localTimeout('lock_timeout', RECORD_LOCK_TIMEOUT_MS);
const STATEMENT_TIMEOUT = localTimeout('statement_timeout', RECORD_STATEMENT_TIMEOUT_MS);

export class SourceBackoffDao implements BlockLedger {
    /** @param db - The food-schema Drizzle client. */
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Write a block, keeping the later end when one is already recorded. The reason and the observation time follow
     * whichever block ends later, so the row always says why it ends when it does.
     *
     * @param block - The source, why it is blocked, and for how many whole seconds from now.
     * @throws Any database failure unchanged, including a lock not granted in time (55P03) or a statement cancelled by
     *   `statement_timeout` (57014); the transport reports it as its own.
     * @sideEffect Upserts `source_backoff`.
     */
    public async record(block: SourceBlock): Promise<void> {
        await this.db.transaction(async (tx) => {
            await tx.execute(LOCK_TIMEOUT);
            await tx.execute(STATEMENT_TIMEOUT);
            await tx.execute(sql`
                INSERT INTO source_backoff (source, blocked_until, reason, observed_at)
                VALUES (
                    ${block.source}::food_source,
                    now() + make_interval(secs => ${block.seconds}::int),
                    ${block.reason},
                    now()
                )
                ON CONFLICT (source) DO UPDATE SET
                    blocked_until = GREATEST(source_backoff.blocked_until, EXCLUDED.blocked_until),
                    reason = CASE
                        WHEN EXCLUDED.blocked_until > source_backoff.blocked_until THEN EXCLUDED.reason
                        ELSE source_backoff.reason
                    END,
                    observed_at = CASE
                        WHEN EXCLUDED.blocked_until > source_backoff.blocked_until THEN EXCLUDED.observed_at
                        ELSE source_backoff.observed_at
                    END
            `);
        });
    }
}
