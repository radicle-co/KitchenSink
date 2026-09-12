/**
 * The RANKING CONFORMANCE CONTRACT (plan U5) — the one place the shared ranking invariant is stated, run by
 * BOTH search surfaces against their OWN data-access layer and their own real database.
 *
 * DESIGN PATTERN: **Template Method as a contract test.** The plan's rule for U5 is "shared rule, never
 * shared SQL": food-service and recipe-service each render their own statement over their own base metric
 * (`similarity` vs `word_similarity` — KTD-1), so nothing links the two implementations at compile time.
 * What links them is this function: each service supplies a {@link RankedSurface} adapter and this module
 * supplies the assertions, so a rule that changes in `@kitchensink/recipe-core` and is only mirrored into
 * ONE of the two statements fails on the other.
 *
 * ## Why it asserts ORDER and not score
 *
 * The two surfaces do not agree on what a score IS, and one of them does not return a score at all —
 * recipe-service's `IngredientsDal.search` returns `Ingredient`s, and the tiered expression exists only in
 * its `ORDER BY`. Order is the observable both surfaces share, it is what a user actually experiences, and
 * it is exactly what the plan means by "the score IS the sort key". So the contract predicts the order from
 * the pure policy and asserts the database produced it.
 *
 * ## ⛔ What this catches that nothing else can
 *
 * `classifyRankTier` and the SQL `CASE` are two implementations of one rule in two languages with two regex
 * dialects, and no type links them. Each service's DAO unit test can only assert that its statement has the
 * SHAPE of a ladder; each service's own integration test can only assert its own examples. This is the one
 * assertion that says: for this corpus, Postgres and TypeScript put the rows in the same order, on both
 * surfaces. A fold that diverges on a diacritic, a plural arm that Postgres applies and JavaScript does not,
 * a `WITH ORDINALITY` that gets dropped so `tokens[1]` stops being the head — each of those is invisible
 * everywhere else and fails here.
 *
 * ## The corpus is deliberately adversarial, not representative
 *
 * Every entry exists because it can distinguish the two implementations: an attractor that shares a word
 * with the query, a comma-inverted USDA name, a plural, a diacritic, a hyphen, a percentage, a typo that
 * must survive on the base metric alone. It is NOT a relevance judgement set — `judgementSet.ts` is that,
 * and it measures a different thing (are we returning the RIGHT row) against a different bar (a human
 * annotator).
 */
import { expect, it } from 'vitest';
import { describeRankingName, describeRankingQuery } from '@kitchensink/recipe-core/resolution/ranking-terms';
import { classifyRankTier } from '@kitchensink/recipe-core/resolution/ranking-tiers';

/** One row as the conformance corpus seeds it, and as a surface returns it. */
export interface ConformanceRow {
    /** The surface's own row identifier. */
    readonly id: string;
    /** The display name the ranking is computed against. */
    readonly name: string;
    /**
     * The FNDDS consumption-prior fraction to seed for this row (plan U5), or absent for none. The
     * contract's use of it is the LADDER GUARANTEE: a row carrying a FULL prior must still never outrank a
     * row one rung above it — the intra-rung effect is each surface's own integration case, because the
     * base metric that decides within a rung is exactly what this module refuses to model.
     */
    readonly priorFraction?: number;
}

/**
 * The adapter one search surface supplies.
 *
 * ⚠️ Deliberately NOT a database handle. The contract must run the surface's REAL statement — the whole
 * point is to compare Postgres against TypeScript — so the adapter owns seeding and searching in whatever
 * shape that service's DAL takes, and this module never writes SQL of its own.
 */
export interface RankedSurface {
    /** A human name for this surface, used in the test titles. */
    readonly surface: string;
    /**
     * Replace the searchable rows with exactly this set.
     *
     * @param rows - The corpus to seed.
     * @sideEffect Truncates and writes the surface's table.
     */
    seed(rows: readonly ConformanceRow[]): Promise<void>;
    /**
     * Run the surface's real ranked search.
     *
     * @param query - The query to rank.
     * @returns The rows in the order the statement produced them.
     * @sideEffect Reads the surface's table.
     */
    search(query: string): Promise<readonly ConformanceRow[]>;
}

/** One corpus entry: a row, and why it is in the corpus. */
interface CorpusEntry {
    readonly id: string;
    readonly name: string;
    readonly priorFraction?: number;
    readonly why: string;
}

/**
 * The adversarial corpus. Every name is chosen to sit on a rung the query can move it off, or to be an
 * attractor that shares a word with a query and must NOT be promoted by that alone.
 */
const CORPUS: readonly CorpusEntry[] = [
    { id: 'r01', name: 'Flour', why: 'exact rung for `flour`' },
    { id: 'r02', name: 'Carob flour', why: 'the attractor: contains the query, heads a different food' },
    { id: 'r03', name: 'Flour, wheat, all-purpose, enriched', why: 'head rung, and the length penalty inside it' },
    { id: 'r04', name: 'Flour, all purpose', why: 'exact rung for the comma-inverted query' },
    { id: 'r05', name: 'Milk, whole, 3.25% milkfat', why: 'a percentage inside a name; head rung for `milk`' },
    { id: 'r06', name: 'Crackers, milk', why: 'the milk attractor' },
    { id: 'r07', name: 'Sugars, brown', why: 'plural head, comma inversion, token-set rung for `brown sugar`' },
    { id: 'r08', name: 'Candies, sugar-coated almonds', why: 'the sugar attractor, hyphenated' },
    { id: 'r09', name: 'Vinegar, red wine', why: 'full three-token inversion' },
    { id: 'r10', name: 'Wine, red, table', why: 'shares two tokens with `red wine vinegar` and must stay at base' },
    { id: 'r11', name: 'Egg, whole, raw', why: 'singular catalog name against a plural query' },
    { id: 'r12', name: 'Peppers, jalapeno, raw', why: 'the catalog spelling of a word cooks type with a tilde' },
    { id: 'r13', name: 'Chives, raw', why: 'plural head plus a preparation term' },
    { id: 'r14', name: 'Chives, freeze-dried', why: 'the same head, a different preparation' },
    { id: 'r15', name: 'All-purpose flour', why: 'hyphenation, and the row the `flor` typo must still reach' },
    { id: 'r16', name: 'Butter, salted', why: 'head rung for `butter`' },
    { id: 'r17', name: 'Peanut butter, smooth', why: 'the butter attractor' },
    { id: 'r18', name: 'Molasses', why: 'a word the plural rule over-folds — identically on both sides' },
    {
        id: 'r19',
        name: 'Cookies, butter, commercially prepared',
        priorFraction: 1,
        why: 'U5: an attractor carrying a FULL prior — must still sit below the head rung for `butter`',
    },
];

/**
 * How many of {@link QUERIES} must observe rows on two or more different rungs before the monotonicity
 * assertion is credited as having proved anything.
 *
 * ⚠️ A floor, not an exact count: the two surfaces retrieve differently (the catalog's `%` threshold vs the
 * local table's `word_similarity`), so the exact number legitimately differs between them. What must not
 * differ is that the ladder had real work to do on both.
 */
const MIN_DISCRIMINATING_QUERIES = 5;

/**
 * The queries the contract ranks the corpus with. Each one separates at least two rungs.
 */
const QUERIES: readonly string[] = [
    'flour',
    'flour, all purpose',
    'all purpose flour',
    'milk',
    'brown sugar',
    'red wine vinegar',
    'eggs',
    'jalapeño peppers',
    'chives',
    'butter',
    'molasses',
    'flor',
];

/**
 * The order the pure policy predicts, for the rows a statement actually returned.
 *
 * ⚠️ It re-orders the OBSERVED rows rather than the whole corpus, deliberately. Which rows MATCH is the
 * retrieval question (each surface's `WHERE`, and U6's match strategy), and it is not what this contract is
 * about; which order they come back in is. Comparing against the whole corpus would make every retrieval
 * change look like a ranking regression.
 *
 * ⚠️ Rows the policy cannot separate — same rung, and the surface's base metric is not modelled here — are
 * compared as a SET within their rung rather than as a sequence, because the base metric is precisely the
 * part of the score this module has no business predicting.
 *
 * @param observed - The rows the statement returned, in its order.
 * @param query - The query they were ranked against.
 * @returns The rung of each observed row, in observed order. Pure.
 */
function rungsOf(observed: readonly ConformanceRow[], query: string): readonly number[] {
    const terms = describeRankingQuery(query);
    const ladder = ['base', 'covered', 'head', 'tokenSet', 'exact'] as const;

    return observed.map((row) => ladder.indexOf(classifyRankTier(describeRankingName(row.name), terms)));
}

/**
 * Register the shared ranking conformance contract for one surface.
 *
 * Call it from inside a `describe` in the surface's own integration suite, so it runs against that service's
 * real DAL and real database.
 *
 * @param surface - The adapter for the surface under test.
 * @sideEffect Registers vitest cases; each seeds and queries a real database.
 */
export function registerRankingConformance(surface: RankedSurface): void {
    it(`${surface.surface}: never returns a lower rung before a higher one`, async () => {
        await surface.seed(CORPUS);

        const violations: string[] = [];

        for (const query of QUERIES) {
            const observed = await surface.search(query);
            const rungs = rungsOf(observed, query);

            for (let index = 1; index < rungs.length; index += 1) {
                if (rungs[index]! > rungs[index - 1]!) {
                    violations.push(
                        `${query}: "${observed[index - 1]!.name}" (rung ${rungs[index - 1]}) ` +
                            `before "${observed[index]!.name}" (rung ${rungs[index]})`,
                    );
                }
            }
        }

        // ⛔ Every violation at once, not the first: a fold that diverges shifts many rows, and reporting one
        // of them turns a single systematic defect into a dozen sequential debugging rounds.
        expect(violations).toEqual([]);
    });

    it(`${surface.surface}: the corpus DISCRIMINATES — the ladder is not passing on a flat result`, async () => {
        await surface.seed(CORPUS);

        const spans: string[] = [];

        for (const query of QUERIES) {
            const rungs = rungsOf(await surface.search(query), query);

            if (new Set(rungs).size > 1) {
                spans.push(query);
            }
        }

        // ⛔ Without this, the monotonicity assertion above is satisfied by ANY result set where every row
        // sits on the same rung — including an empty one. This is the guard that says the contract had
        // something to order. It is stated as a floor rather than an exact figure because WHICH rows a
        // surface retrieves is that surface's `WHERE`, not this contract's business.
        expect(spans.length).toBeGreaterThanOrEqual(MIN_DISCRIMINATING_QUERIES);
    });

    it(`${surface.surface}: is DETERMINISTIC — the same query twice returns the same sequence`, async () => {
        await surface.seed(CORPUS);

        const drifted: string[] = [];

        for (const query of QUERIES) {
            const first = (await surface.search(query)).map((row) => row.id);
            const second = (await surface.search(query)).map((row) => row.id);

            if (first.join(',') !== second.join(',')) {
                drifted.push(query);
            }
        }

        // The `name ASC` tiebreak exists so a page does not shuffle between two identical calls — which is
        // what a score with ties and no deterministic tiebreak produces, intermittently, under a different
        // plan. A user re-typing the same query must not see the list reorder under their cursor.
        expect(drifted).toEqual([]);
    });
}
