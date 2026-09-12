/**
 * READING A COUNT OFF A ROW, ONCE (plan U12/U13).
 *
 * ⛔ THE FAILURE THIS PREVENTS IS A BACKSTOP REPORTING A CLEAN BILL OF HEALTH. Every backstop's reads return
 * counts, and the obvious way to unpack them — `const row = result.rows[0] as Record<string, number>` then
 * `row['stale_leases'] ?? 0` — turns a renamed column, an edited subquery, an empty result set or a driver
 * handing back a string into **zero owed work**. `classifyOwed` then returns `undefined`, the check says
 * nothing, and the stage looks exactly as healthy as one where nothing is stuck. That is the precise failure
 * ADR-0041 exists to remove, reintroduced inside the code that implements it, and it shipped in one of the
 * three backstops while its two siblings narrowed correctly.
 *
 * ⛔ SO A MISSING OR NON-NUMERIC COLUMN THROWS. A throw is loud: the handler fails, the log line names the
 * column, and the cron monitor's missed check-in says the backstop is down. Every one of those is a signal.
 * Zero is not.
 *
 * ⚠️ `Number()` rather than a `typeof === 'number'` test, because `pg` returns `bigint` and `numeric` columns
 * as STRINGS by default and every count here is cast `::int` in SQL — so a string is the NORMAL shape for a
 * value that is nonetheless a perfectly good number, and rejecting it would fail on correct reads.
 */

/**
 * Read one numeric column off a result row.
 *
 * @param row - The row, as the driver returned it.
 * @param key - The column name.
 * @returns The value as a number. Pure.
 * @throws {Error} when the row is absent, the column is missing, or the value is not numeric.
 */
export function countFrom(row: unknown, key: string): number {
    if (row === null || typeof row !== 'object') {
        throw new Error(`queue check read returned no row while looking for ${key}`);
    }

    const raw = (row as Record<string, unknown>)[key];

    // ⛔ `null`, `undefined` AND `''` ARE REFUSED BEFORE `Number()` SEES THEM, because `Number()` maps all
    // three to 0 — which is finite, passes every numeric check, and is exactly the "nothing is owed" answer
    // this module exists to stop a backstop giving. A `MAX()` over no rows without a `COALESCE` returns NULL,
    // so this is the ordinary shape of the mistake, not an exotic one.
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
        throw new Error(`queue check read returned a null or absent ${key}`);
    }

    // ⚠️ A BOOLEAN IS REFUSED TOO. `Number(true)` is 1 and `Number(false)` is 0, so a column that became a
    // boolean would read as a plausible count — and the zero half is the silent direction again.
    if (typeof raw !== 'number' && typeof raw !== 'string') {
        throw new Error(`queue check read returned a non-numeric ${key}`);
    }

    const value = Number(raw);

    if (!Number.isFinite(value)) {
        throw new Error(`queue check read returned a non-numeric ${key}`);
    }

    return value;
}

/**
 * Read several numeric columns off a result row.
 *
 * @param row - The row, as the driver returned it.
 * @param keys - The column names, mapped to the field each becomes.
 * @returns One number per key. Pure.
 * @throws {Error} on the first absent or non-numeric column.
 */
export function countsFrom<K extends string>(row: unknown, keys: Readonly<Record<K, string>>): Record<K, number> {
    const out = Object.create(null) as Record<K, number>;

    for (const field of Object.keys(keys) as K[]) {
        out[field] = countFrom(row, keys[field]);
    }

    return out;
}
