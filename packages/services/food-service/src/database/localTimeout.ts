/**
 * A timeout for the current transaction alone. `set_config(…, true)` is `SET LOCAL` with a bindable value, so it ends
 * with the transaction and the pooled connection keeps no timeout.
 *
 * @module
 */
import { sql, type SQL } from 'drizzle-orm';

/** The timeouts a food transaction bounds itself with. */
export type LocalTimeoutName = 'statement_timeout' | 'lock_timeout';

/** Each setting's name as a literal, so a statement log shows which timeout a transaction set. */
const SETTING: Readonly<Record<LocalTimeoutName, SQL>> = {
    statement_timeout: sql`'statement_timeout'`,
    lock_timeout: sql`'lock_timeout'`,
};

/**
 * The statement that sets one timeout for the current transaction. Pure.
 *
 * @param name - The timeout.
 * @param ms - Its length, in whole milliseconds.
 * @returns The statement.
 * @throws {RangeError} when `ms` is not a positive whole number: `0` would turn the timeout off.
 */
export function localTimeout(name: LocalTimeoutName, ms: number): SQL {
    if (!Number.isSafeInteger(ms) || ms <= 0) {
        throw new RangeError(
            `localTimeout: ${name} must be a positive whole number of milliseconds, got ${String(ms)}`,
        );
    }

    return sql`SELECT set_config(${SETTING[name]}, ${`${String(ms)}ms`}, true)`;
}
