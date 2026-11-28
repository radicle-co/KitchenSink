import { is, SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import type { RecordedCall } from './makeFakeDrizzle.js';

const dialect = new PgDialect();

/**
 * The Postgres text and params of the SQL fragment a DAL selected under `key`, read from the fake client's recorded
 * `select(...)` call. Throws when the first select has no SQL fragment under that key, so a missing or wrong select fails
 * here instead of passing as `undefined`.
 */
export function selectedSql(calls: readonly RecordedCall[], key: string): { sql: string; params: unknown[] } {
    const selection = calls.find((call) => call.method === 'select')?.args[0];
    const value: unknown =
        typeof selection === 'object' && selection !== null ? Reflect.get(selection, key) : undefined;

    if (!is(value, SQL)) {
        throw new Error(`the first select has no SQL fragment under "${key}"`);
    }

    return dialect.sqlToQuery(value);
}
