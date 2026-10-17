/**
 * LOCAL e2e — the SC-007 load fixture, seeded by its own statements into a real migrated Postgres (plan U30; curated
 * plan U8). Target: LOCAL (`docs/CODING_STANDARDS.md` §7.1a): it proves the fixture and the schema, never a deploy.
 *
 * ## ⛔ What only this tier can prove
 *
 * `tests/load/__tests__/perfFixtureDistribution.test.ts` measures the corpus the TypeScript generator produces. What
 * decides what SC-007 actually measures lives on the other side of a boundary it cannot cross:
 *
 *  1. **The SQL rendering.** Every rule in `perfFixture.ts` is written twice, and the seed runs entirely in Postgres —
 *     a wrong modulus, a wrong bound array or an off-by-one in a subscript produces rows nobody in this process sees.
 *  2. **`food.rank_tokens`.** A STORED GENERATED column, Postgres' mirror of `rankingTokens` in a different regex
 *     dialect. If the two folds disagreed on ONE word, that word's probe would retrieve nothing while the unit suite
 *     reported a perfect ladder.
 *  3. **The retrieval itself.** A probe is only a measurement if the real statement returns rows for it.
 *  4. **Who may write it (KTD-12).** The seeded half is written here as `food_seeder` and the live half as
 *     `food_app`, so a fixture row the seed's ownership trigger or `food_variant_seed_only` refuses fails the seed.
 *     The CLI's superuser connection proves none of that: the trigger reads a superuser as the owner.
 *  5. **The variant read.** Whether SC-007's probes reach `FoodsService.namedVariantsOf`'s one variant read, and what
 *     that read returns over the seeded variants.
 *
 * It seeds {@link POPULATION} roots rather than 50,000. Every count is compared to the TypeScript prediction FOR THAT
 * SAME POPULATION, exactly, so a smaller corpus loses no signal.
 */
import { createHash } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { describeRankingQuery } from '@kitchensink/recipe-core/resolution/ranking-terms';

import { FoodSearchDao } from '../../src/foods/dao/foodSearch.dao.js';
import { FoodVariantDao } from '../../src/foods/dao/foodVariant.dao.js';
import { leftoverTokens, matchVariant, namesOf } from '../../src/foods/domain/variantQueryMatch.js';
import {
    HEAD_TERM_REGIMES,
    HEAD_TERM_REGIME_FLOOR,
    HEAD_TERM_SELECTIVITY_P50,
    HEAD_TERM_SELECTIVITY_TAIL,
    countHeadTermOccurrences,
    profileHeadTerms,
} from '../load/headTermSelectivity.js';
import {
    HEAD_TERM_AXES,
    PERF_NUTRIENTS,
    SEED_VARIANTS_PER_ROOT,
    SHAPE_HEAD_AXIS,
    VARIANT_SLOTS,
    buildSearchProbes,
    perfFoodAliases,
    perfFoodDescription,
    perfFoodId,
    perfFoodName,
    perfNormalizedName,
    perfVariantCount,
    perfVariantId,
    perfVariantIndex,
    perfVariantParts,
    type PerfSearchProbes,
} from '../load/perfFixture.js';
import { type PerfFixtureSizes, seedCatalogPopulation, seedLivePopulation } from '../load/preparePerfFixture.js';
import { makeDb } from '../support/db.js';
import { foodDb } from '../support/roleDb.js';

/**
 * How many seeded roots.
 *
 * ⚠️ Not 50,000, and not a token handful. The narrowest head term takes ~1.2% of the corpus, so this must stay large
 * enough that EVERY one of the 108 head terms lands on rows, and above the variant count axis's 2,647-slot cycle so
 * every count the seed holds is drawn. At 10,000 the narrowest term still carries ~118 rows.
 */
const POPULATION = 10_000;

/** The sizes: a read-target slice below the variant axis's cycle, so a contiguous draw would show in it. */
const SIZES: PerfFixtureSizes = { resolvedFoods: POPULATION, readTargets: 500, pendingFoods: 50, notFoundFoods: 50 };

/** The ledger digest the seeded half commits with: the fixture's own, since it is no committed seed. */
const FIXTURE_SEED_SHA = createHash('sha256')
    .update(`perf fixture ${JSON.stringify(SIZES)}`)
    .digest('hex');

/** Every root index of the seeded population. */
const ROOT_INDEXES = Array.from({ length: POPULATION }, (_unused, index) => index);

/** The corpus the TypeScript generator predicts. */
const PREDICTED_NAMES = ROOT_INDEXES.map((index) => perfFoodName('resolved', index));

/** Token counts over that predicted corpus. */
const PREDICTED_COUNTS = countHeadTermOccurrences(PREDICTED_NAMES);

/** The variants the TypeScript draws, by root, as `[variant index, …]`. */
const PREDICTED_VARIANTS = ROOT_INDEXES.map((rootIndex) =>
    Array.from({ length: perfVariantCount(rootIndex) }, (_unused, slot) => perfVariantIndex(rootIndex, slot)),
);

/** The committed seed's share of roots with at least one variant (`perfFixture.ts`'s measured histogram). */
const SEED_SHARE_WITH_VARIANTS =
    SEED_VARIANTS_PER_ROOT.filter(([count]) => count > 0).reduce((sum, [, roots]) => sum + roots, 0) /
    SEED_VARIANTS_PER_ROOT.reduce((sum, [, roots]) => sum + roots, 0);

/** The committed seed's mean variants per root. */
const SEED_MEAN_VARIANTS =
    SEED_VARIANTS_PER_ROOT.reduce((sum, [count, roots]) => sum + count * roots, 0) /
    SEED_VARIANTS_PER_ROOT.reduce((sum, [, roots]) => sum + roots, 0);

/** How far one head term's share of roots with a variant may sit from the seed's (`VARIANT_COUNT_AXIS`'s stride). */
const MAX_SPREAD_DEVIATION = 0.05;

/** The id prefix every seeded root shares. */
const RESOLVED_ID_PREFIX = perfFoodId('resolved', 0).slice(0, 11);

describe('the SC-007 load fixture, seeded into a real Postgres (LOCAL e2e)', () => {
    let app: pg.Pool;
    let seeder: pg.Pool;
    let dao: FoodSearchDao;
    let variants: FoodVariantDao;

    beforeAll(async () => {
        await foodDb().truncate();
        app = new pg.Pool({ connectionString: foodDb().appUrl });
        seeder = new pg.Pool({ connectionString: foodDb().seederUrl });

        // The seeded half as the seed's own role, the live half as the service's: KTD-12's two writers. The seeded half
        // commits as one transaction that records a seed, as the seed's apply does: the seeder's commit of catalog rows
        // with no ledger row of its own is refused (migration 0021).
        const seed = await seeder.connect();

        try {
            await seed.query('BEGIN');
            await seedCatalogPopulation(seed, SIZES);
            await seed.query('INSERT INTO catalog_seed_ledger (seed_sha) VALUES ($1)', [FIXTURE_SEED_SHA]);
            await seed.query('COMMIT');
        } catch (error) {
            await seed.query('ROLLBACK').catch(() => undefined);

            throw error;
        } finally {
            seed.release();
        }

        await seedLivePopulation(app, SIZES);

        dao = new FoodSearchDao(makeDb(app));
        variants = new FoodVariantDao(makeDb(app));
    }, 300_000);

    afterAll(async () => {
        await app?.end();
        await seeder?.end();
    });

    /** Rows of `food` in the seeded population, in id order. */
    async function seededRoots<T extends pg.QueryResultRow>(columns: string): Promise<T[]> {
        const { rows } = await app.query<T>(`SELECT ${columns} FROM food WHERE id LIKE $1 ORDER BY id`, [
            `${RESOLVED_ID_PREFIX}%`,
        ]);

        return rows;
    }

    describe('roots', () => {
        it('seeds every requested row — no name collided on food_normalized_name_catalog_unique', async () => {
            const { rows } = await app.query<{ status: string; total: number }>(
                'SELECT status::text AS status, count(*)::int AS total FROM food GROUP BY status ORDER BY 1',
            );

            expect(rows).toStrictEqual([
                { status: 'NOT_FOUND', total: SIZES.notFoundFoods },
                { status: 'PENDING', total: SIZES.pendingFoods },
                { status: 'RESOLVED', total: POPULATION },
            ]);
        });

        it('renders in SQL exactly what the TypeScript renders, across the whole corpus', async () => {
            // The draw tables are strided, so an index that agrees proves nothing about the next one.
            const rows = await seededRoots<{
                name: string;
                normalized_name: string;
                description: string;
                aliases: string;
            }>('name, normalized_name, description, aliases');

            expect(rows).toHaveLength(POPULATION);
            expect(rows.map((row) => row.name)).toEqual(PREDICTED_NAMES);
            expect(rows.map((row) => row.normalized_name)).toEqual(
                ROOT_INDEXES.map((index) => perfNormalizedName('resolved', index)),
            );
            expect(rows.map((row) => row.description)).toEqual(ROOT_INDEXES.map(perfFoodDescription));
            expect(rows.map((row) => row.aliases)).toEqual(ROOT_INDEXES.map(perfFoodAliases));
        });

        it.each(Object.keys(HEAD_TERM_AXES))(
            'retrieves the predicted number of rows for every %s head term through rank_tokens',
            async (axisName) => {
                // ⛔ The load-bearing case: the TypeScript fold's prediction against the fold Postgres computed in a
                // STORED GENERATED column, for every word — the branch `FoodSearchDao.relevanceQuery` retrieves on.
                const axis = HEAD_TERM_AXES[axisName as keyof typeof HEAD_TERM_AXES];
                const observed: Record<string, number> = {};
                const predicted: Record<string, number> = {};

                for (const term of axis.terms) {
                    const folded = describeRankingQuery(term).head!;
                    const { rows } = await app.query<{ total: number }>(
                        `SELECT count(*)::int AS total FROM food
                          WHERE status = 'RESOLVED' AND rank_tokens @> ARRAY[$1]::text[]`,
                        [folded],
                    );

                    observed[folded] = rows[0]!.total;
                    predicted[folded] = PREDICTED_COUNTS.get(folded) ?? 0;
                }

                expect(Object.keys(observed), `compared ${Object.keys(observed).length} head terms`).toHaveLength(
                    axis.terms.length,
                );
                expect(
                    Math.min(...Object.values(observed)),
                    `narrowest observed count: ${JSON.stringify(observed)}`,
                ).toBeGreaterThan(0);
                expect(observed).toEqual(predicted);
            },
            120_000,
        );

        it.each(Object.keys(HEAD_TERM_AXES))(
            'lands the %s axis ladder on the catalog anchors in the database',
            async (axisName) => {
                const axis = HEAD_TERM_AXES[axisName as keyof typeof HEAD_TERM_AXES];
                const counts = new Map<string, number>();

                for (const term of axis.terms) {
                    const folded = describeRankingQuery(term).head!;
                    const { rows } = await app.query<{ total: number }>(
                        `SELECT count(*)::int AS total FROM food
                          WHERE status = 'RESOLVED' AND rank_tokens @> ARRAY[$1]::text[]`,
                        [folded],
                    );

                    counts.set(folded, rows[0]!.total);
                }

                const profile = profileHeadTerms(axisName, axis.terms, counts, POPULATION);
                const counted = HEAD_TERM_REGIMES.map((regime) => `${regime}=${profile.regimeCounts[regime]}`).join(
                    ' ',
                );

                expect(
                    profile.tail,
                    `axis '${axisName}' in-database tail ${(profile.tail * 100).toFixed(2)}%, ` +
                        `p50 ${(profile.p50 * 100).toFixed(2)}%, regimes ${counted}`,
                ).toBeGreaterThan(HEAD_TERM_SELECTIVITY_TAIL * 0.8);
                expect(profile.tail).toBeLessThan(HEAD_TERM_SELECTIVITY_TAIL * 1.2);
                expect(profile.p50).toBeGreaterThan(HEAD_TERM_SELECTIVITY_P50 * 0.8);
                expect(profile.p50).toBeLessThan(HEAD_TERM_SELECTIVITY_P50 * 1.2);

                for (const regime of HEAD_TERM_REGIMES) {
                    expect(
                        profile.regimeCounts[regime],
                        `axis '${axisName}' counted ${counted} in the database`,
                    ).toBeGreaterThanOrEqual(HEAD_TERM_REGIME_FLOOR);
                }
            },
            120_000,
        );

        it('returns rows for every head-bearing probe through the real search statement', async () => {
            // `search.load.js` asserts this as `expectHits` during a k6 run. A probe that retrieves nothing measures
            // the speed of doing no work, so it is asserted here too, against the statement production runs.
            const probes = buildSearchProbes(8);
            const empty: string[] = [];
            let checked = 0;

            for (const [shape, axisName] of Object.entries(SHAPE_HEAD_AXIS)) {
                if (axisName === null) {
                    continue;
                }

                for (const probe of probes[shape as keyof PerfSearchProbes]) {
                    checked += 1;

                    if ((await dao.search(probe, 'search-e2e-caller')).length === 0) {
                        empty.push(`${shape}:'${probe}'`);
                    }
                }
            }

            expect(checked, `ran ${checked} head-bearing probes against FoodSearchDao.search`).toBeGreaterThan(0);
            expect(empty, `probes that retrieved nothing: ${empty.join(', ') || '(none)'}`).toEqual([]);
        }, 120_000);

        it('still returns nothing for the miss probe', async () => {
            // The mirror of the case above: if EVERY probe returned rows, the suite above could be passing because
            // the predicate matches everything.
            const misses = buildSearchProbes(4).miss;

            expect(misses.length).toBeGreaterThan(0);

            for (const probe of misses) {
                expect(await dao.search(probe, 'search-e2e-caller'), `miss probe '${probe}' matched rows`).toEqual([]);
            }
        }, 60_000);
    });

    describe('variants (curated plan U8)', () => {
        it('seeds each root the live variants the TypeScript draws, in id order', async () => {
            const rows = await seededRoots<{ variants: string[] }>(
                `array(SELECT v.id FROM food_variant v WHERE v.food_id = food.id AND v.retired_at IS NULL
                        ORDER BY v.id) AS variants`,
            );
            const expected = PREDICTED_VARIANTS.map((indexes) => indexes.map(perfVariantId));

            expect(
                expected.flat().length,
                `the TypeScript draws ${expected.flat().length} variants for ${POPULATION} roots`,
            ).toBeGreaterThan(POPULATION);
            expect(rows.map((row) => row.variants)).toEqual(expected);
        });

        it('labels every variant with the parts the TypeScript draws, in contract order', async () => {
            const { rows } = await app.query<{ id: string; parts: string[] }>(
                `SELECT v.id,
                        array(SELECT p.attribute::text || ':' || p.ordinal || ':' || p.text FROM food_variant_part p
                               WHERE p.variant_id = v.id ORDER BY p.attribute, p.ordinal) AS parts
                   FROM food_variant v ORDER BY v.id`,
            );
            // Variant indexes rise with the root, then the slot, and the ids zero-pad them, so this is id order.
            const expected = PREDICTED_VARIANTS.flat().map((variantIndex) => ({
                id: perfVariantId(variantIndex),
                parts: perfVariantParts(variantIndex).map((part) => `${part.attribute}:${part.ordinal}:${part.text}`),
            }));

            expect(rows.length).toBeGreaterThan(0);
            expect(rows).toEqual(expected);
        });

        it('gives every variant a seed-owned item its one source row and one header cite (KTD-6, KTD-19)', async () => {
            const { rows } = await app.query<{ variants: number; faults: string[] }>(
                `WITH facts AS (
                     SELECT v.id,
                            i.seed_owned,
                            i.natural_key,
                            (SELECT array_agg(s.source::text || ':' || s.external_key) FROM food_sources s
                              WHERE s.item_id = v.item_id) AS sources,
                            (SELECT count(*) FROM food_nutrition h WHERE h.food_variant_id = v.id) AS headers,
                            (SELECT array_agg(c.dataset::text || ':' || c.external_key || ':' || c.match::text)
                               FROM food_nutrition h JOIN food_nutrition_citation c ON c.nutrition_id = h.id
                              WHERE h.food_variant_id = v.id) AS citations,
                            (SELECT count(*) FROM food_nutrient_view n WHERE n.food_variant_id = v.id) AS nutrients
                       FROM food_variant v JOIN food_item i ON i.id = v.item_id
                 )
                 SELECT count(*)::int AS variants,
                        coalesce(array_agg(id) FILTER (WHERE NOT coalesce(
                            seed_owned
                            AND sources = ARRAY['usda:' || substr(natural_key, 5)]
                            AND headers = 1
                            AND citations = ARRAY['usdaSrFoundation:' || substr(natural_key, 5) || ':exact']
                            AND nutrients = $1,
                            false
                        )), '{}') AS faults
                   FROM facts`,
                [PERF_NUTRIENTS.length],
            );

            expect(rows[0]!.variants, `checked ${rows[0]!.variants} variants`).toBe(PREDICTED_VARIANTS.flat().length);
            expect(rows[0]!.faults).toEqual([]);
        });

        it('puts the seeded population on seed-owned items and the live one on unseeded items (KTD-12)', async () => {
            const { rows } = await app.query<{ owner: string; seed_owned: boolean; items: number }>(
                `SELECT CASE WHEN v.id IS NOT NULL THEN 'variant' ELSE f.status::text END AS owner,
                        i.seed_owned,
                        count(*)::int AS items
                   FROM food_item i
                   LEFT JOIN food f ON f.item_id = i.id
                   LEFT JOIN food_variant v ON v.item_id = i.id
                  GROUP BY 1, 2 ORDER BY 1, 2`,
            );

            expect(rows).toStrictEqual([
                { owner: 'NOT_FOUND', seed_owned: false, items: SIZES.notFoundFoods },
                { owner: 'PENDING', seed_owned: false, items: SIZES.pendingFoods },
                { owner: 'RESOLVED', seed_owned: true, items: POPULATION },
                { owner: 'variant', seed_owned: true, items: PREDICTED_VARIANTS.flat().length },
            ]);
        });

        it("lands the database's variants on the committed seed's distribution", async () => {
            const { rows } = await app.query<{ roots: number; with_variants: number; variants: number; most: number }>(
                `SELECT count(*)::int AS roots,
                        count(*) FILTER (WHERE n > 0)::int AS with_variants,
                        sum(n)::int AS variants,
                        max(n)::int AS most
                   FROM (SELECT count(v.id) AS n FROM food f LEFT JOIN food_variant v ON v.food_id = f.id
                          WHERE f.status = 'RESOLVED' GROUP BY f.id) AS per_root`,
            );
            const { roots, with_variants: withVariants, variants: total, most } = rows[0]!;
            const share = withVariants / roots;
            const mean = total / roots;

            expect(roots).toBe(POPULATION);
            expect(
                share,
                `share of roots with a variant ${share.toFixed(4)}, seed ${SEED_SHARE_WITH_VARIANTS.toFixed(4)}`,
            ).toBeGreaterThan(SEED_SHARE_WITH_VARIANTS - 0.02);
            expect(share).toBeLessThan(SEED_SHARE_WITH_VARIANTS + 0.02);
            expect(
                mean,
                `mean variants per root ${mean.toFixed(3)}, seed ${SEED_MEAN_VARIANTS.toFixed(3)}`,
            ).toBeGreaterThan(SEED_MEAN_VARIANTS * 0.95);
            expect(mean).toBeLessThan(SEED_MEAN_VARIANTS * 1.05);
            expect(most, 'the heaviest root carries the seed’s heaviest count').toBe(VARIANT_SLOTS);
        });

        it('gives the read targets, the roots GET /:id reads, the seed’s share of variants', async () => {
            // The read targets are the LEADING roots, so a draw that walked its table in order would hand them one
            // block of it — all zero, or all one count — and SC-001 would read a variant list nothing like the seed's.
            const { rows } = await app.query<{ with_variants: number }>(
                `SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM food_variant v WHERE v.food_id = f.id))::int
                        AS with_variants
                   FROM food f WHERE f.id = ANY($1::text[])`,
                [Array.from({ length: SIZES.readTargets }, (_unused, index) => perfFoodId('resolved', index))],
            );
            const share = rows[0]!.with_variants / SIZES.readTargets;

            expect(
                share,
                `${rows[0]!.with_variants} of ${SIZES.readTargets} read targets carry a variant`,
            ).toBeGreaterThan(SEED_SHARE_WITH_VARIANTS - 0.05);
            expect(share).toBeLessThan(SEED_SHARE_WITH_VARIANTS + 0.05);
        });

        it.each(Object.keys(HEAD_TERM_AXES))(
            'spreads variants evenly across the %s axis, so no head term’s hits carry all the variants',
            async (axisName) => {
                const axis = HEAD_TERM_AXES[axisName as keyof typeof HEAD_TERM_AXES];
                const { rows } = await app.query<{ term: string; roots: number; with_variants: number }>(
                    `SELECT t.term, count(*)::int AS roots,
                            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM food_variant v WHERE v.food_id = f.id))::int
                            AS with_variants
                       FROM unnest($1::text[]) AS t(term)
                       JOIN food f ON f.status = 'RESOLVED' AND f.rank_tokens @> ARRAY[t.term]
                      GROUP BY t.term`,
                    [axis.terms.map((term) => describeRankingQuery(term).head!)],
                );
                const deviations = rows.map((row) => ({
                    term: row.term,
                    deviation: Math.abs(row.with_variants / row.roots - SEED_SHARE_WITH_VARIANTS),
                }));
                const worst = deviations.reduce((left, right) => (right.deviation > left.deviation ? right : left));

                expect(rows, `measured ${rows.length} ${axisName} terms`).toHaveLength(axis.terms.length);
                expect(
                    worst.deviation,
                    `'${worst.term}' is ${(worst.deviation * 100).toFixed(1)} points off the seed's share`,
                ).toBeLessThan(MAX_SPREAD_DEVIATION);
            },
            120_000,
        );

        it('makes SC-007’s probes issue the variant read, over roots that carry live variants', async () => {
            // `FoodsService.namedVariantsOf` is the authority: it reads variants for the unauthored hits whose query
            // leaves words beyond the hit's best name or synonym, and attaches the one variant `matchVariant` picks.
            // This replays that rule over the real search statement for every shape `search.load.js` runs.
            const probes = buildSearchProbes(8);
            const perShape: Record<
                string,
                { probes: number; rootsRead: number; variantsRead: number; attached: number }
            > = {};

            for (const shape of Object.keys(SHAPE_HEAD_AXIS) as (keyof PerfSearchProbes)[]) {
                const tally = { probes: 0, rootsRead: 0, variantsRead: 0, attached: 0 };

                for (const query of probes[shape]) {
                    const hits = await dao.search(query, 'search-e2e-caller');
                    const candidates = hits.filter(
                        (hit) =>
                            hit.userId === null && leftoverTokens(query, namesOf(hit.name, hit.aliases)).length > 0,
                    );
                    const live = await variants.listLive(
                        candidates.map((hit) => hit.id),
                        { withNutrition: false },
                    );

                    tally.probes += 1;
                    tally.rootsRead += candidates.length;
                    tally.variantsRead += live.length;
                    tally.attached += candidates.filter(
                        (hit) =>
                            matchVariant(
                                query,
                                namesOf(hit.name, hit.aliases),
                                live.filter((variant) => variant.rootId === hit.id),
                            ) !== undefined,
                    ).length;
                }

                perShape[shape] = tally;
            }

            const total = Object.values(perShape).reduce((sum, tally) => sum + tally.variantsRead, 0);
            const report = JSON.stringify(perShape);

            expect(Object.keys(perShape), report).toHaveLength(Object.keys(SHAPE_HEAD_AXIS).length);
            expect(
                Object.values(perShape).reduce((sum, tally) => sum + tally.rootsRead, 0),
                `roots the variant read was issued for, per shape: ${report}`,
            ).toBeGreaterThan(0);
            expect(total, `variants the read returned, per shape: ${report}`).toBeGreaterThan(0);
        }, 120_000);
    });
});
