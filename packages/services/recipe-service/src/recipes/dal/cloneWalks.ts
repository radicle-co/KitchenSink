/**
 * The two recursive clone-tree walks the source-correction DALs share, written once so the read that shows a staff member
 * the newest correction and the read that checks it cannot walk different trees.
 *
 * @pattern Specification: each walk is one named query fragment, composed into the statement that needs it.
 */
import { sql, type SQL } from 'drizzle-orm';

/**
 * `WITH RECURSIVE chain(id, depth)`: the recipe and every ancestor it was cloned from, nearest first, cycle-guarded. The caller
 * filters `NOT is_cycle`.
 *
 * @param id - The recipe at the bottom of the chain.
 * @returns The CTE, to open a statement.
 */
export function ancestorChainCte(id: string): SQL {
    return sql`
        WITH RECURSIVE chain(id, depth) AS (
            SELECT ${id}::uuid, 0
            UNION ALL
            SELECT r.cloned_from_id, c.depth + 1 FROM chain c JOIN recipes r ON r.id = c.id WHERE r.cloned_from_id IS NOT NULL
        ) CYCLE id SET is_cycle USING path`;
}

/**
 * `WITH RECURSIVE descendants(id)`: every recipe cloned from the root, at any depth, through any cook's clones.
 *
 * @param rootId - The recipe whose clones are walked.
 * @returns The CTE, to open a statement.
 */
export function descendantsCte(rootId: string): SQL {
    return sql`
        WITH RECURSIVE descendants(id) AS (
            SELECT id FROM recipes WHERE cloned_from_id = ${rootId}::uuid
            UNION
            SELECT r.id FROM recipes r JOIN descendants d ON r.cloned_from_id = d.id
        )`;
}
