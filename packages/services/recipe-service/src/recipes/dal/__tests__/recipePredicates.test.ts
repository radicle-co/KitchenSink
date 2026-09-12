/**
 * Unit tests for the recipe read-predicate builders (S-R3). These compile the composable Drizzle `SQL`
 * conditions with the Postgres dialect (no connection needed) and assert the emitted SQL + bound params,
 * so a change to the tombstone or visibility rule is caught here — the module is the single source both
 * the query-builder DALs and the raw search CTE consume, and the one place W8-a.3 will add the draft term.
 */
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import { activeRecipe, publishedOrOwnedBy, readableBy, viewableBy } from '../recipePredicates.js';

const dialect = new PgDialect();

/** Compile a Drizzle SQL condition to its `{ sql, params }` string form (connection-free). */
function compile(condition: Parameters<PgDialect['sqlToQuery']>[0]): { sql: string; params: unknown[] } {
    const query = dialect.sqlToQuery(condition);

    return { sql: query.sql.toLowerCase(), params: query.params };
}

describe('recipe read predicates (S-R3)', () => {
    it('activeRecipe() is the tombstone filter (deleted_at IS NULL)', () => {
        const { sql } = compile(activeRecipe());

        expect(sql).toContain('"deleted_at" is null');
    });

    it('viewableBy() is "public OR owned by the viewer", with the viewer bound as a param', () => {
        const { sql, params } = compile(viewableBy('01HVIEWER0000000000000000'));

        expect(sql).toContain('"visibility" =');
        expect(sql).toContain(' or ');
        expect(sql).toContain('"owner_id" =');
        expect(params).toContain('01HVIEWER0000000000000000');
    });

    it('publishedOrOwnedBy() is "published OR owned by the viewer" (W8-a.3 draft boundary)', () => {
        const { sql, params } = compile(publishedOrOwnedBy('01HVIEWER0000000000000000'));

        expect(sql).toContain('"status" =');
        expect(sql).toContain(' or ');
        expect(sql).toContain('"owner_id" =');
        // 'published' is bound as a param alongside the viewer id — nothing is string-spliced.
        expect(params).toEqual(['published', '01HVIEWER0000000000000000']);
    });

    it('readableBy() composes tombstone AND visibility AND draft-status (the full read boundary)', () => {
        const { sql, params } = compile(readableBy('01HVIEWER0000000000000000'));

        expect(sql).toContain('"deleted_at" is null');
        expect(sql).toContain(' and ');
        expect(sql).toContain('"visibility" =');
        expect(sql).toContain('"status" ='); // draft rows are excluded from non-owner reads (W8-a.3)
        expect(sql).toContain('"owner_id" =');
        expect(params).toContain('01HVIEWER0000000000000000');
        expect(params).toContain('published');
    });

    it('binds both operands as parameters (no SQL-injection surface: public literal + viewer id)', () => {
        const { params } = compile(viewableBy('01HVIEWER0000000000000000'));

        // Drizzle parameterizes both the 'public' constant and the viewer id — nothing is string-spliced.
        expect(params).toEqual(['public', '01HVIEWER0000000000000000']);
    });
});
