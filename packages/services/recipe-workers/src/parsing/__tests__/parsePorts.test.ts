/**
 * `createParseCachePort` — the ONE property worth proving without a database.
 *
 * ⚠️ Everything else these ports do is SQL, and a unit test over a fake queryable would prove only that the
 * fake was called with the arguments the test itself supplied — the classic coverage-theatre shape, and the
 * `handle-sync-worker` lesson `parseLeg.integration.test.ts` opens with. The real assertions live there,
 * against a real PostgreSQL.
 *
 * What DOES belong here is the empty-batch short circuit, and it belongs in THIS tier specifically: the
 * integration suite is `describe.skipIf(!DATABASE_URL)`, so a guard placed there stops running the moment
 * somebody has no database — silently, and on exactly the machines least likely to notice.
 *
 * ## Where this assertion came from
 *
 * `recipe-service`'s `ParseCacheDal` — a second, UNCALLED implementation of these same two statements — was
 * deleted on 2026-09-02. This is its unit suite's claim, moved onto the implementation that actually runs.
 *
 * ⚠️ The RATIONALE did not survive the move intact, and the difference matters. Drizzle rendered
 * `inArray(col, [])` as `in ()`, which PostgreSQL rejects as a syntax error — so for the DAL the short
 * circuit was correctness. This port sends raw SQL, where the same batch would render `= ANY('{}'::text[])`
 * and be perfectly legal. What is asserted here is therefore the PORT CONTRACT's own requirement — "an EMPTY
 * batch must not reach the database" ({@link ParseCachePort.findForLines}) — not a crash that cannot happen
 * on this statement. Do not "simplify" this away on the grounds that the empty array is harmless in SQL: the
 * pipeline consults the cache for nothing at all whenever every line was answered by the corrections tier,
 * and a pointless round trip per import is the cost the contract exists to refuse.
 */
import { describe, expect, it } from 'vitest';

import type { LineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { createParseCachePort, type ParseQueryable } from '../parsePorts.js';

/**
 * A queryable that FAILS if it is used at all.
 *
 * The assertion is "no query was issued", and a handle that throws states that far more sharply than a spy
 * whose call count is checked afterwards: if the short circuit is removed, the test fails at the point of the
 * mistake with the mistake's own name on it.
 */
const forbiddenQueryable: ParseQueryable = {
    query(text: string): never {
        throw new Error(`createParseCachePort touched the database for an empty batch: ${text}`);
    },
};

describe('createParseCachePort().findForLines', () => {
    it('returns nothing for an EMPTY batch without issuing a query', async () => {
        const cache = createParseCachePort(forbiddenQueryable);

        await expect(cache.findForLines([])).resolves.toEqual([]);
    });

    it('returns a NEW empty array each time, so one caller cannot mutate an array another holds', async () => {
        const cache = createParseCachePort(forbiddenQueryable);

        const first = await cache.findForLines([]);
        const second = await cache.findForLines([] as readonly LineDigest[]);

        expect(first).not.toBe(second);
    });
});
