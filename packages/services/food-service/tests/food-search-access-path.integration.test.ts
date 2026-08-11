/**
 * T-202 / SC-007 — the ACCESS PATH the relevance search statement gets, and the equivalence that is what
 * makes changing it legitimate at all.
 *
 * ## What T-202 turned out to be, measured
 *
 * The ticket's hypothesis was that `narrow`/`phrase` are slow because the statement "ranks every matched
 * row before `LIMIT 20`". Measured on a 50,000-food store shaped like the one CI seeds, that is **wrong**:
 * `narrow` matches 364 rows and the top-N heapsort over them costs **0.14ms of a 45.8ms statement**. The
 * cost is the `name % query` trigram-similarity branch, and specifically its ACCESS PATH —
 * `food_name_trgm_idx` (GIN) answers `name % 'raw chicken breast'` with **9,758 candidate rows for 368
 * true matches**, because a GIN trigram similarity search admits any row sharing
 * `ceil(0.3 x n_query_trigrams)` trigrams while a true `similarity() >= 0.3` needs roughly three quarters
 * of them. The bitmap heap scan then re-evaluates the predicate — including a fresh `similarity()` call,
 * measured at **2.19µs** — on the 9,754 rows it throws away, touching all 4,250 heap blocks of the table.
 *
 * `food_name_trgm_gist_idx` (0004) answers the same operator with 368 candidates for 368 matches: 30.5ms
 * of the statement becomes 8.0ms, and the whole statement 45.8ms → 14.6ms in CI's build order (this
 * migration runs before the seed, so the index is built by the bulk INSERT; created after the rows it
 * packs better and reads 12.4ms).
 *
 * The branch is **not** dead work, which is why it is made cheap instead of removed: for `narrow` it
 * contributes **335 of the 364 matched rows** on its own. (T-198's finding 4 — "`name % query` contributes
 * nothing at ANY length" — was measured with single-word needles against long names; a multi-word needle
 * IS a large fraction of the name, so its similarity clears the 0.3 threshold easily.) Removing it would
 * change which rows match, which per T-198 is a product decision and not a DAO edit.
 *
 * ## What this suite asserts, and the one thing it deliberately does NOT
 *
 * `search.load.js` owns the latency, but it is HEAVY-TIER (the `heavy-e2e` label, the nightly, or a manual
 * dispatch), so on an ordinary PR the win is unguarded — the same hole T-198a closed for the routing. A
 * latency assertion could not guard it here anyway: this workstation measures the statement ~4.4x faster
 * than CI (45.8ms local against ~200ms of a 209.9ms CI p95), so a local millisecond number says nothing
 * about the gate. CI is the arbiter, and it measured `narrow` 209.9 -> 42.4ms p95 and the SC-007 aggregate
 * 154.3 -> 39.8ms p95 across this change (runs 31454689817 -> 31459435996).
 *
 * 1. **Equivalence (the semantics).** The statement `FoodSearchDao.search` actually sends must return the
 *    IDENTICAL `(id, name, score)` SEQUENCE with every index access path disabled — a pure Seq Scan, where
 *    no index can participate — and with them enabled. An index cannot change a result set (the operator
 *    is rechecked from the heap), and this is what PROVES that rather than asserting it, for this change
 *    and for the next one. It is also the only kind of assertion here that is deterministic and
 *    hardware-independent. **Its own vacuity is guarded**: one test asserts that the two runs really did
 *    get different plans and that the index-side plan really did use `food_name_trgm_gist_idx`. An earlier
 *    draft of this suite proved nothing twice over — it seeded 6,000 rows, where the planner answers this
 *    statement with a Seq Scan even with every index available, and it applied the planner settings with a
 *    plain `SET`, which survives `client.release()` and leaked onto the next pooled connection.
 * 2. **The index exists, with the opclass that makes it work.** A GiST trigram index is not
 *    interchangeable with the GIN one that was already there: GIN is the better answer for `ILIKE` and the
 *    worse answer for `%`. "Consolidating" the two, or dropping 0004, is the realistic regression.
 *
 * **A query-plan cost gate was written, measured and REMOVED — do not re-add it.** The natural plan for
 * this statement is genuinely unstable below production scale, and forcing the planner does not recover
 * the discrimination:
 *
 *   - Natural plan choice flips on table size and on how diverse the seeded names are, because
 *     `similarity()` and the `%` operator's `similarity_op` both carry the DEFAULT `procost` of 1 while
 *     costing ~100x a simple operator. Measured on production-shaped stores: Seq-Scan-and-filter at 6,000
 *     rows, trigram BitmapOr at 12,000, Seq Scan again at 25,000, BitmapOr at 50,000.
 *   - `SET enable_seqscan = off` (T-198a already found it non-discriminating for the routing question)
 *     buys a full `Index Scan` with the whole `OR` in `Filter` — every row still gets a `similarity()`
 *     call, so the metric reads identically with and without the new index (measured: 25.20x wasted
 *     recheck at 6,000 rows and 25.24x at 18,000, unchanged by 0004).
 *   - Adding `enable_indexscan = off` on top buys a bitmap scan over `food_status_idx` — which matches
 *     every `RESOLVED` row — and the `%` predicate lands in `Filter` again, so no node names the index.
 *
 * A gate that has to disable four access paths to see the one it cares about is asserting the planner's
 * arithmetic, not the code's behaviour. `drain-claim-scaling.integration.test.ts` can assert a plan
 * because its statement has ONE sane plan at every depth; this one does not. The latency contract stays
 * with `search.load.js`, and the finding about `procost` is escalated in `tests/load/README.md` rather
 * than encoded here.
 *
 * @implements FR-008 FR-010
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FoodSearchDao } from '../src/foods/dao/food-search.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema } from './support/db.js';

/**
 * Store size for the equivalence proof — **SC-007's stated population**, and not a smaller convenient one.
 *
 * A smaller store makes this suite VACUOUS, which an earlier draft was: below roughly 25,000 rows the
 * planner answers this statement with a plain Seq Scan even with every index available (measured at 6,000,
 * 12,000 and 20,000 rows, with both description shapes), and no combination of `enable_*` settings reaches
 * the trigram indexes either — forcing an index path just picks `food_status_idx`, which matches every
 * `RESOLVED` row. So both sides of the comparison were the same scan and it proved nothing. At 50,000 the
 * planner reaches the trigram BitmapOr, which is what makes the comparison real. The
 * "really do get different plans" test below is the guard that keeps it real: if the crossover ever moves,
 * it fails with that instruction rather than passing silently.
 */
const EQUIVALENCE_SIZE = 50_000;

// The name vocabulary. The four list LENGTHS are coprime-ish and large enough that a three-word needle is
// selective (~1/1,771 of the store) rather than matching a twentieth of it — with a small vocabulary every
// name is trigram-similar to every needle and the similarity branch stops discriminating, which is exactly
// the property under test.
//
// The `description` is the k6 fixture's VERBOSE shape rather than production's `description := name`, and
// that is deliberate: it roughly doubles the table's page count, which is what tips the planner onto the
// trigram BitmapOr at this size. This suite's job is to prove an ACCESS PATH cannot move a result, so it
// has to be seeded such that an access path is actually taken — and this is the shape the k6 gate measures.
// Production's shape is not left unproven: the same comparison was run over 932 probes on BOTH 50,000-row
// shapes (see `specs/003-usda-food-data/tasks.md` T-202), and on the production shape the planner picks a
// Seq Scan, i.e. the index is not involved there at all — which is escalated as Finding 4 in
// `tests/load/README.md`, not something this suite can assert.
const PREPARATIONS = ['raw', 'cooked', 'roasted', 'canned', 'frozen', 'dried', 'grilled'];
const INGREDIENTS = [
    'chicken',
    'beef',
    'pork',
    'salmon',
    'tuna',
    'broccoli',
    'spinach',
    'carrot',
    'potato',
    'rice',
    'quinoa',
    'lentil',
    'almond',
    'walnut',
    'yogurt',
    'cheddar',
    'mozzarella',
    'apple',
    'banana',
    'blueberry',
    'oat',
    'barley',
    'chickpea',
];
const CUTS = ['breast', 'thigh', 'fillet', 'whole', 'sliced', 'diced', 'puree', 'flour', 'flakes', 'ground'];
const BRANDS = ['northvale', 'harborline', 'stonefield', 'brightoak', 'clearwater', 'goldenrow', 'ironhill'];

/**
 * The probes the equivalence proof runs: one per branch of the `OR`, plus the edges an access path could
 * plausibly move. `reaches` is in the failure message, so a red test names the branch that shifted.
 */
const EQUIVALENCE_PROBES: readonly { readonly probe: string; readonly reaches: string }[] = [
    { probe: 'chicken', reaches: 'one lexeme + both ILIKE branches (~1/23 of the store)' },
    { probe: 'raw chicken', reaches: 'a two-lexeme AND plus the similarity branch (the k6 `phrase` shape)' },
    { probe: 'raw chicken breast', reaches: 'a three-lexeme AND (the k6 `narrow` shape — the slowest)' },
    { probe: 'northvale', reaches: 'the independent brand axis (the k6 `brand` shape)' },
    { probe: 'raw chikcen breast', reaches: 'the similarity branch carrying a typo no lexeme or substring matches' },
    { probe: 'rawchickenbreast', reaches: 'the similarity branch with the word boundaries removed' },
    { probe: 'ick', reaches: 'the ILIKE branches alone — a mid-word substring is no lexeme' },
    { probe: 'east', reaches: 'the ILIKE branches alone, word-final substring' },
    { probe: 'RAW CHICKEN BREAST', reaches: 'case folding across every branch' },
    { probe: 'raw  chicken', reaches: 'repeated whitespace (plainto_tsquery collapses it, ILIKE does not)' },
    { probe: 'chicken raw', reaches: 'reversed word order — FTS is order-independent, ILIKE is not' },
    { probe: 'zqxjkvwf', reaches: 'no branch matches: the whole predicate runs and returns nothing' },
    { probe: 'raw%chicken', reaches: 'a LIKE wildcard inside the pattern' },
    { probe: 'raw_chicken', reaches: 'a LIKE single-character wildcard inside the pattern' },
    { probe: 'the', reaches: 'an English stopword — plainto_tsquery is empty, so only ILIKE can match' },
    { probe: 'raw chicken breast, northvale', reaches: 'the most trigrams of any probe: the worst case' },
    { probe: 'égg', reaches: 'a non-ASCII letter through every branch' },
    { probe: 'flour', reaches: 'a cut word: matches in the trailing name position' },
    { probe: '000001', reaches: 'digits only — the serial, which only the ILIKE branches can see' },
];

describe.skipIf(!DATABASE_URL)('FoodSearchDao relevance access path (T-202, SC-007)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = makePool();
        await resetSchema(pool);
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, description, status)
             SELECT 'f' || lpad(s.i::text, 25, '0'), built.name, lower(built.name),
                    built.name || '. Nutrition information for a ' || built.name ||
                        ' product; includes macronutrients and household measures per 100 grams.',
                    'RESOLVED'
               FROM generate_series(0, $1 - 1) AS s(i),
                    LATERAL (
                        SELECT ($2::text[])[(s.i % array_length($2::text[], 1)) + 1] || ' ' ||
                               ($3::text[])[(s.i % array_length($3::text[], 1)) + 1] || ' ' ||
                               ($4::text[])[(s.i % array_length($4::text[], 1)) + 1] || ', ' ||
                               ($5::text[])[(s.i % array_length($5::text[], 1)) + 1] || ' ' ||
                               lpad(s.i::text, 6, '0') AS name
                    ) AS built`,
            [EQUIVALENCE_SIZE, PREPARATIONS, INGREDIENTS, CUTS, BRANDS],
        );
        await pool.query('ANALYZE food');
    }, 60_000);

    afterAll(async () => {
        await pool.end();
    });

    /**
     * The EXACT relevance statement `FoodSearchDao.search` sends, captured from a Drizzle query logger.
     *
     * Captured, never restated: a copy of the SQL in this file would be a second representation of the
     * thing under test, and the copy is the one that silently stops matching production — which for an
     * equivalence proof is worse than no proof, because it would keep proving two forms of a statement
     * nobody runs are the same. The statement is identified by the `name % $n` predicate that IS the
     * subject of this suite, and the identification is asserted, so losing that branch fails loudly
     * instead of quietly proving the word-initial prefix statement equivalent to itself.
     *
     * @param query - A 3+ character query (1–2 characters route elsewhere — T-198).
     * @returns SQL text plus bound parameters.
     * @sideEffect Executes one search against `food`.
     */
    async function captureRelevanceStatement(query: string): Promise<{ text: string; values: readonly unknown[] }> {
        const seen: { text: string; values: readonly unknown[] }[] = [];
        const logged = makeDb(pool, {
            logQuery: (text, values) => {
                seen.push({ text, values });
            },
        });

        await new FoodSearchDao(logged).search(query);

        const relevance = seen.filter((statement) => /name % \$\d+/.test(statement.text));

        expect(
            relevance,
            'no statement carrying the `name % $n` similarity predicate was captured from ' +
                'FoodSearchDao.search. Either the relevance statement no longer has that branch — in ' +
                'which case WHICH ROWS MATCH changed, and that is a product decision (T-198), not an ' +
                'access-path change — or the Drizzle logger stopped firing.',
        ).toHaveLength(1);

        return relevance[0] as { text: string; values: readonly unknown[] };
    }

    /**
     * Run a captured statement in its own transaction with the given planner settings applied.
     *
     * `SET LOCAL` inside `BEGIN`/`COMMIT`, and not a plain `SET`, for a reason that made an earlier draft of
     * this suite VACUOUS: a plain `SET` is session-scoped, and `client.release()` returns the connection to
     * the pool without a `DISCARD ALL`, so the next `pool.connect()` hands back the same connection with
     * `enable_bitmapscan` still off. The "with indexes" run then executed the same Seq Scan as the ground
     * truth and the comparison below passed no matter what the indexes did. `SET LOCAL` cannot outlive the
     * transaction, so the leak is not merely unlikely — it is unrepresentable.
     *
     * @param statement - SQL text plus bound parameters.
     * @param settings - `SET LOCAL` arguments (e.g. `'enable_bitmapscan = off'`), applied in the transaction.
     * @returns The statement's rows, in the order returned.
     * @sideEffect Opens a connection and reads `food` inside a transaction that is always ended.
     */
    async function runWith(
        statement: { text: string; values: readonly unknown[] },
        settings: readonly string[],
    ): Promise<readonly Record<string, unknown>[]> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            for (const setting of settings) {
                await client.query(`SET LOCAL ${setting}`);
            }

            const { rows } = await client.query<Record<string, unknown>>({
                text: statement.text,
                values: [...statement.values],
            });

            await client.query('COMMIT');

            return rows;
        } catch (error) {
            await client.query('ROLLBACK');

            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Prove the two runs really did get different plans, so a green comparison means "the plans agree" and
     * never "the settings leaked and both runs were the same scan". Counts `food` scan node types.
     *
     * @param statement - SQL text plus bound parameters.
     * @param settings - `SET LOCAL` arguments applied before the `EXPLAIN`.
     * @returns The node types the plan used to read `food`, plus every index it named.
     * @sideEffect Opens a connection and executes the statement inside a transaction that is rolled back.
     */
    async function scanNodeTypes(
        statement: { text: string; values: readonly unknown[] },
        settings: readonly string[],
    ): Promise<{ readonly types: readonly string[]; readonly indexes: readonly string[] }> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            for (const setting of settings) {
                await client.query(`SET LOCAL ${setting}`);
            }

            const explained = await client.query<{ 'QUERY PLAN': { Plan: Record<string, unknown> }[] }>({
                text: `EXPLAIN (FORMAT JSON) ${statement.text}`,
                values: [...statement.values],
            });

            await client.query('ROLLBACK');

            const types: string[] = [];
            const indexes: string[] = [];

            const walk = (node: Record<string, unknown> | undefined): void => {
                if (node === undefined) {
                    return;
                }

                if (node['Relation Name'] === 'food') {
                    types.push(String(node['Node Type']));
                }

                if (node['Index Name'] !== undefined) {
                    indexes.push(String(node['Index Name']));
                }

                for (const child of (node['Plans'] as Record<string, unknown>[] | undefined) ?? []) {
                    walk(child);
                }
            };

            walk(explained.rows[0]?.['QUERY PLAN']?.[0]?.Plan);

            return { types, indexes };
        } finally {
            client.release();
        }
    }

    /** The settings that leave the planner no index access path at all — a pure Seq Scan is the only option. */
    const NO_INDEX_PATHS = ['enable_indexscan = off', 'enable_bitmapscan = off', 'enable_indexonlyscan = off'];

    describe('equivalence: an access path cannot move a row or a rank (the T-198 mandate)', () => {
        it('the two runs below really do get different plans (this proof is not comparing a scan to itself)', async () => {
            const statement = await captureRelevanceStatement('raw chicken breast');

            expect((await scanNodeTypes(statement, NO_INDEX_PATHS)).types).toEqual(['Seq Scan']);

            const natural = await scanNodeTypes(statement, []);

            expect(
                natural.types,
                'with every index available the planner still chose a plain Seq Scan, so every comparison ' +
                    'below is a Seq Scan against a Seq Scan and proves nothing. Either the planner-setting ' +
                    'scope leaked across pooled connections (it must be SET LOCAL in a transaction), or the ' +
                    'store is too small for an index path to win — raise EQUIVALENCE_SIZE.',
            ).not.toContain('Seq Scan');
            expect(
                natural.indexes,
                'the plan under test does not use food_name_trgm_gist_idx, so this suite is proving ' +
                    'equivalence for an access path that is not the one T-202 introduced. The planner picks ' +
                    'the trigram BitmapOr only once the table is large enough; if this reds, the crossover ' +
                    'moved and EQUIVALENCE_SIZE needs raising (or the index was dropped).',
            ).toContain('food_name_trgm_gist_idx');
        });

        it.each(EQUIVALENCE_PROBES)(
            'returns an identical (id, name, score) sequence with and without index access paths — $probe',
            async ({ probe, reaches }) => {
                const statement = await captureRelevanceStatement(probe);
                // Ground truth: no index access path of ANY kind is available, so both the rows and their
                // order come from the predicate and the ORDER BY alone.
                const withoutIndexes = await runWith(statement, NO_INDEX_PATHS);
                const withIndexes = await runWith(statement, []);

                expect(
                    withIndexes,
                    `'${probe}' reaches ${reaches}, and the access path moved its result. An index CANNOT ` +
                        'do that (the operator is rechecked from the heap), so this is a lossy index or a ' +
                        'non-deterministic ORDER BY, not a tuning question.',
                ).toEqual(withoutIndexes);
            },
        );

        it('the probe set carries rows through the similarity branch and NOTHING else', async () => {
            // Without this, the proof above could pass on a probe set that only ever matched via FTS or
            // ILIKE — i.e. it would prove nothing about the branch 0004 exists to make cheap.
            const { rows } = await pool.query<{ probe: string; similarity_only: string }>(
                `SELECT p.probe, count(f.id) AS similarity_only
                   FROM unnest($1::text[]) AS p(probe)
                   LEFT JOIN food f
                     ON f.status = 'RESOLVED' AND f.name IS NOT NULL
                    AND f.name % p.probe
                    AND NOT (f.search_vector @@ plainto_tsquery('english', p.probe))
                    AND f.name NOT ILIKE '%' || p.probe || '%'
                    AND f.description NOT ILIKE '%' || p.probe || '%'
                  GROUP BY p.probe
                  HAVING count(f.id) > 0`,
                [EQUIVALENCE_PROBES.map((entry) => entry.probe)],
            );

            expect(
                rows.map((row) => `${row.probe} (${row.similarity_only})`),
                'no probe matches rows via `name %` alone, so the equivalence proof above never exercises ' +
                    'the branch T-202 is about. Add a needle that is a large fraction of a seeded name.',
            ).not.toHaveLength(0);
        });
    });

    describe('the GiST trigram index 0004 adds (the artifact the win depends on)', () => {
        it('indexes food.name with gist_trgm_ops, alongside — not instead of — the GIN index', async () => {
            const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
                `SELECT indexname, indexdef FROM pg_indexes
                  WHERE schemaname = 'public' AND tablename = 'food' AND indexdef ILIKE '%trgm%'`,
            );
            const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));

            expect(
                // Stringified so a MISSING index fails with the message below rather than a TypeError.
                String(byName.get('food_name_trgm_gist_idx')),
                'food_name_trgm_gist_idx is missing or is not a GiST trigram index on name. It is what ' +
                    'answers `name % query` with one candidate per match instead of ~26 (T-202); GIN ' +
                    'cannot, and GIN is still the better answer for the ILIKE branches, so the two are ' +
                    'not interchangeable and neither may be dropped for the other.',
            ).toMatch(/USING gist \(name gist_trgm_ops\)/);

            // Both must remain: the planner picks GiST for `%` and GIN for `ILIKE`, per branch.
            expect([...byName.keys()].sort()).toEqual([
                'food_description_trgm_idx',
                'food_name_trgm_gist_idx',
                'food_name_trgm_idx',
            ]);
        });
    });
});
