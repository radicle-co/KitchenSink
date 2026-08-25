/**
 * `ParseCacheDal` — the ONE property worth proving without a database (plan U20).
 *
 * ⚠️ Everything else this DAL does is SQL, and a unit test over a mocked Drizzle handle would prove only that
 * the mock was called — the classic coverage-theatre shape. The real assertions live in
 * `__tests__/integration/ingredients/parseCache.dal.integration.test.ts`, against a real Postgres.
 *
 * What DOES belong here is the empty-batch short circuit, because it is a decision the DAL makes BEFORE any
 * SQL exists, and its failure mode is a crash rather than a wrong answer: Drizzle renders `inArray(col, [])`
 * as `in ()`, which Postgres rejects as a syntax error. The pipeline reaches an empty batch on the ordinary
 * path — a recipe whose every line was answered by U21's correction tier consults the cache for nothing at
 * all — so this is a live path, not a defensive one.
 */
import { describe, expect, it } from 'vitest';

import type { LineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import type { RecipeDrizzle } from '../../../database/database.module.js';
import { ParseCacheDal } from '../parseCache.dal.js';

/**
 * A Drizzle handle that FAILS if it is touched at all.
 *
 * The assertion is "no query was issued", and a handle that throws states that far more sharply than a spy
 * whose call count is checked afterwards: if the short circuit is removed, the test fails at the point of the
 * mistake with the mistake's own name on it.
 */
const forbiddenDb = new Proxy(
    {},
    {
        get(_target, property): never {
            throw new Error(`ParseCacheDal touched the database (.${String(property)}) for an empty batch`);
        },
    },
) as RecipeDrizzle;

describe('ParseCacheDal.findForLines', () => {
    it('returns nothing for an empty batch WITHOUT issuing a query', async () => {
        // ⛔ `inArray(col, [])` renders `in ()`, which Postgres rejects outright. The answer for an empty batch
        // is knowable without asking, and asking is an error — so the guard is correctness, not an optimisation.
        const dal = new ParseCacheDal(forbiddenDb);

        await expect(dal.findForLines([])).resolves.toEqual([]);
    });

    it('returns a NEW empty array each time, so a caller cannot mutate a shared one', async () => {
        const dal = new ParseCacheDal(forbiddenDb);
        const first = await dal.findForLines([]);
        const second = await dal.findForLines([] as readonly LineDigest[]);

        expect(first).not.toBe(second);
    });
});
