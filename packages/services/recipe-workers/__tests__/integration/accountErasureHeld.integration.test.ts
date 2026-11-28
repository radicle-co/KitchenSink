/**
 * Account erasure's recipe step over a REAL drizzle session on a recording pool double (mocked database, DD12): the statements
 * the handler really issues, in order. A held recipe (ADR-0105) must meet the donate-flip BEFORE the removed set is computed
 * and deleted, both statements must carry the one read function with the bound keys, and the flip must not name a held
 * rule of its own. What the database answers for a row is the LOCAL e2e tier's (`heldErasure.e2e.test.ts`).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { PRIVATE_ONLY_SOURCE_KEYS } from '@kitchensink/recipe-core';

import { eraseRecipeRows } from '../../src/handlers/accountErasureWorker.js';

const OWNER = '01JHELDINTEGRATIONOWNER001';
const ELECTED_HELD = '00000000-0000-4000-8000-00000000d001';

function recordingPool(): { pool: Pool; statements: { text: string; values: unknown[] }[] } {
    const statements: { text: string; values: unknown[] }[] = [];
    const query = async (
        text: string | { text: string; values?: unknown[] },
        values?: unknown[],
    ): Promise<{ rows: unknown[]; rowCount: number; fields: unknown[] }> => {
        const sql = typeof text === 'string' ? text : text.text;

        statements.push({
            text: sql.replace(/\s+/g, ' ').trim(),
            values: values ?? (typeof text === 'string' ? [] : (text.values ?? [])),
        });

        return { rows: [], rowCount: 0, fields: [] };
    };
    const client = { query, release: (): void => undefined };

    return { pool: { query, connect: async () => client } as unknown as Pool, statements };
}

describe('erasure statement order with the read rule', () => {
    it('flips the election first, then selects and deletes the removed set, each through recipe_held_from_readers with the bound keys', async () => {
        const { pool, statements } = recordingPool();

        await eraseRecipeRows(drizzle(pool), OWNER, [ELECTED_HELD]);

        const keys = JSON.stringify(PRIVATE_ONLY_SOURCE_KEYS);
        const flip = statements.findIndex((s) => /^update recipes set visibility/i.test(s.text));
        const select = statements.findIndex((s) => /^select id from recipes where/i.test(s.text));
        const del = statements.findIndex((s) => /^delete from recipes where/i.test(s.text));

        expect(flip).toBeGreaterThan(-1);
        expect(flip).toBeLessThan(select);
        expect(select).toBeLessThan(del);

        for (const index of [flip, select, del]) {
            expect(statements[index]?.text).toMatch(/recipe_held_from_readers\(recipes, \$\d+::jsonb\)/i);
            expect(statements[index]?.values).toContain(keys);
        }

        // The election is a bound parameter of the flip only; the removed-set statements never carry it, so a held elected id
        // is removed by the predicate, not by an id list.
        expect(statements[flip]?.values).toContain(JSON.stringify([ELECTED_HELD]));
        expect(statements[del]?.values).not.toContain(JSON.stringify([ELECTED_HELD]));
        expect(statements[flip]?.text).not.toMatch(/source_correction_hold|recipe_holds_third_party_source/i);
    });
});
