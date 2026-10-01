/**
 * Remove the bindings a suite created, for the recipe-service suites that run against a real database.
 *
 * A binding (`food_lookups`) and its failure record (`unresolved_foods`) are shared rows that no recipe cascade
 * removes, and the foreign keys between them and from the lines are `RESTRICT`: the lines that use them must be
 * deleted first (delete the suite's recipes before calling this), and a settle pointer is cleared before the binding
 * it names.
 */
import type pg from 'pg';

/**
 * Delete every binding whose food id, or whose failure record's name, matches `pattern`, then those records.
 *
 * @param pool - A pool on the suite's database.
 * @param pattern - A SQL `LIKE` pattern: a suite's scope prefix with `%`, or one exact name.
 * @sideEffect Deletes `food_lookups` and `unresolved_foods` rows.
 */
export async function deleteBindingsMatching(pool: pg.Pool, pattern: string): Promise<void> {
    // A settled failure points at the binding its lines moved to, and that pointer is `RESTRICT` too.
    await pool.query(
        `UPDATE unresolved_foods SET settled_lookup_id = NULL
               WHERE name LIKE $1
                  OR settled_lookup_id IN (SELECT id FROM food_lookups WHERE food_id LIKE $1)`,
        [pattern],
    );
    await pool.query(
        `DELETE FROM food_lookups
               WHERE food_id LIKE $1
                  OR unresolved_food_id IN (SELECT id FROM unresolved_foods WHERE name LIKE $1)`,
        [pattern],
    );
    await pool.query(`DELETE FROM unresolved_foods WHERE name LIKE $1`, [pattern]);
}
