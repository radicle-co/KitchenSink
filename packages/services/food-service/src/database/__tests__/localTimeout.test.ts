/**
 * A transaction-scoped timeout (`SET LOCAL`, with a bindable value): the setting is named literally, so a statement log
 * shows which timeout a transaction set, and the milliseconds are bound. The LOCAL e2e tier proves both end with the
 * transaction (`tests/e2e/sourceAdmission.e2e.test.ts`).
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { localTimeout } from '../localTimeout.js';

const dialect = new PgDialect();

describe('localTimeout', () => {
    it.each([
        ['statement_timeout', 500, "SELECT set_config('statement_timeout', $1, true)", '500ms'],
        ['lock_timeout', 2_000, "SELECT set_config('lock_timeout', $1, true)", '2000ms'],
    ] as const)('sets %s to %i ms for the transaction alone', (name, ms, text, bound) => {
        const query = dialect.sqlToQuery(localTimeout(name, ms));

        expect({ sql: query.sql, params: query.params }).toStrictEqual({ sql: text, params: [bound] });
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'refuses %s ms, which would disable the timeout or is no whole number of milliseconds',
        (ms) => {
            expect(() => localTimeout('statement_timeout', ms)).toThrow(RangeError);
        },
    );
});
