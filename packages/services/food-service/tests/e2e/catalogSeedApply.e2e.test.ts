/**
 * LOCAL e2e: the catalog seed applied as `food_seeder` to a food database migrated by food's own runner (curated
 * catalog plan U6, KTD-1, KTD-2, KTD-8, KTD-12; R32, R33, R36, R37, R40; AE5).
 *
 * The verifier is a parameter of the transaction, and its real implementation is another unit's (`src/foods/seed/
 * verify/`). The stand-in here checks something real: inside the apply's own transaction it reads the catalog back
 * through the snapshot DAO and requires the seed to plan as nothing to do against it, so a row the apply wrote wrong
 * fails the apply and rolls it back. Every apply runs on a connection of its own, as KTD-2 requires, so no session
 * state carries from one apply to the next.
 *
 * The cases are KTD-2's and R33's promises against 0018's real keys, triggers and grants: the committed seed applies to
 * an empty database and a second run writes nothing; a seed A, then B (a rename, a merge, a split, a retired root and a
 * retired variant), then A again restores every id; two concurrent applies record one ledger row; a failure halfway
 * leaves the previous seed and ledger; the three timeouts hold inside the transaction and nowhere after it; and KTD-12's
 * two claims retire and forward the live food they take, while an authored food and an unclaimed live food are left
 * exactly as they were.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { provisionRoleDatabase, type RoleDatabase } from '@kitchensink/service-test-harness';

import {
    makeContent,
    makeContentItem,
    makeContentRoot,
    makeContentVariant,
    makeNutrition,
} from '../../src/foods/seed/catalog/__fixtures__/catalogContent.fixtures.js';
import { makeCatalogChanges } from '../../src/foods/seed/catalog/__fixtures__/curatedSeed.fixtures.js';
import { isCatalogApplyError } from '../../src/foods/seed/catalog/catalogPlanApplier.errors.js';
import { buildCatalogPlan, isEmptyPlan } from '../../src/foods/seed/catalog/catalogPlanBuilder.js';
import { CatalogSnapshotDao } from '../../src/foods/seed/catalog/catalogSnapshot.dao.js';
import type { CatalogContent, CatalogSnapshot, LabelCitation } from '../../src/foods/seed/catalog/catalogSnapshot.js';
import { pgSeedSession } from '../../src/foods/seed/catalog/catalogSeedSession.js';
import { composeSeedImage } from '../../src/foods/seed/catalog/seedImage.js';
import { projectSeed } from '../../src/foods/seed/catalog/seedProjection.js';
import { loadSeedSources } from '../../src/foods/seed/catalog/seedSources.js';
import {
    SEED_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    SEED_LOCK_TIMEOUT_MS,
    SEED_STATEMENT_TIMEOUT_MS,
    applyCatalogSeed,
    runCatalogSeed,
    type CatalogSeedResult,
    type SeedClient,
} from '../../src/foods/seed/catalog/catalogSeedTransaction.js';
import { makeCatalogFood } from '../__fixtures__/catalogFood.js';
import { foodDbSpec } from '../support/roleDb.js';

const DATA_DIR = fileURLToPath(new URL('../../src/foods/seed/data/', import.meta.url));

/**
 * This suite's own throwaway database, provisioned and migrated by food's own runner like the tier's.
 *
 * ⚠️ Not the tier's shared `food_e2e_test`: a case here commits a whole seed twice and reads the ledger between, and a
 * second run of the tier emptying the shared database in between made that case report an apply on an empty catalog
 * (measured locally, 2026-10-01, with other suites running against the same server).
 */
const SEED_APPLY_DATABASE = 'food_seedapply_test';

let seedDb: RoleDatabase;

const NO_CHANGES = makeCatalogChanges({ merges: [], aliases: [], exclusions: [], splits: [] });

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

/** The salt blend's label, whose serving is a portion of the root's item citing it (OQ-1). */
const SALT_LABEL: LabelCitation = {
    dataset: 'label',
    url: 'https://example.com/salt-blend',
    retrievedOn: '2026-09-30',
    manufacturer: 'Acme',
    servingLabel: '1/4 tsp',
    servingGrams: '0.8',
};

/** Brisket's item, with the strings the COPY text format must carry unchanged. */
const BRISKET_ITEM = makeContentItem('fdc:100', {
    sources: [
        { source: 'usda', externalKey: '100', lineageKey: 'foundation:13023' },
        { source: 'usda', externalKey: '17', lineageKey: null },
    ],
    portions: [
        { label: '1 cup, line\nbreak', gramWeight: '120', source: { source: 'usda', externalKey: '17' } },
        { label: 'oz', gramWeight: '28.35', source: { source: 'usda', externalKey: '100' } },
    ],
    categories: [
        { name: 'Beef Products', source: { source: 'usda', externalKey: '100' } },
        { name: 'Meats', source: null },
    ],
});

const BRISKET = makeContentRoot({
    synonyms: ['brisket', 'tab\there', 'back\\slash', '\\N', 'café ½'],
    nutrition: {
        ...makeNutrition('fdc:100'),
        values: [
            { name: 'Energy', unit: 'kcal', amount: '250' },
            { name: 'Fiber, total dietary', unit: 'g', amount: null },
            { name: 'Protein', unit: 'g', amount: '21.5' },
        ],
    },
});
const FLAT = makeContentVariant({
    item: 'fdc:101',
    parts: [
        { attribute: 'cut', text: 'flat' },
        { attribute: 'cut', text: 'half' },
        { attribute: 'cookingMethod', text: 'braised' },
    ],
});
const POINT = makeContentVariant({
    item: 'fdc:102',
    parts: [{ attribute: 'cut', text: 'point' }],
    nutrition: makeNutrition('fdc:102'),
});
const TRIMMED = makeContentVariant({
    item: 'fdc:103',
    parts: [{ attribute: 'trim', text: '1/8 inch' }],
    nutrition: makeNutrition('fdc:103'),
});
const CHICKEN = makeContentRoot({
    seedKey: 'fdc:200',
    name: 'chicken breast',
    item: 'fdc:200',
    nutrition: makeNutrition('fdc:200'),
});
const VEAL = makeContentRoot({
    seedKey: 'fdc:300',
    name: 'veal',
    item: 'fdc:300',
    nutrition: makeNutrition('fdc:300'),
});
const VEAL_LOIN = makeContentVariant({
    item: 'fdc:301',
    root: 'fdc:300',
    parts: [{ attribute: 'cut', text: 'loin' }],
    nutrition: makeNutrition('fdc:301'),
});
const SALT = makeContentRoot({
    seedKey: 'curated:salt-blend',
    name: 'salt blend',
    item: 'curated:salt-blend',
    nutrition: { citation: SALT_LABEL, values: [{ name: 'Sodium, Na', unit: 'mg', amount: '23750' }] },
});
const SALT_ITEM = makeContentItem('curated:salt-blend', {
    portions: [{ label: '1/4 tsp', gramWeight: '0.8', citation: SALT_LABEL }],
});
const MYSTERY = makeContentRoot({
    seedKey: 'curated:mystery-spice',
    name: 'mystery spice',
    item: 'curated:mystery-spice',
    nutrition: null,
});

/** Seed A: every shape the port holds. */
const SEED_A: CatalogContent = makeContent(
    [BRISKET, CHICKEN, VEAL, SALT, MYSTERY],
    [FLAT, POINT, TRIMMED, VEAL_LOIN],
    [BRISKET_ITEM, SALT_ITEM],
);

/**
 * Seed B: brisket renamed; chicken merged into brisket as a variant; the point split out as a root of its own; veal
 * and its loin retired; the trimmed variant retired under a brisket that stays.
 */
const SEED_B: CatalogContent = makeContent(
    [
        { ...BRISKET, name: 'Beef Brisket, whole' },
        makeContentRoot({
            seedKey: 'fdc:102',
            name: 'brisket point',
            item: 'fdc:102',
            nutrition: makeNutrition('fdc:102'),
        }),
        SALT,
        MYSTERY,
    ],
    [
        FLAT,
        makeContentVariant({
            item: 'fdc:200',
            parts: [{ attribute: 'formOrVariety', text: 'chicken' }],
            nutrition: makeNutrition('fdc:200'),
        }),
    ],
    [BRISKET_ITEM, SALT_ITEM],
);

/** The ids of a catalog's seed rows, by natural key. */
interface SeedIds {
    readonly roots: Readonly<Record<string, string>>;
    readonly variants: Readonly<Record<string, string>>;
}

/**
 * The stand-in verifier's check: the catalog, read back inside the apply's transaction, plans as nothing to do.
 *
 * @param client - The apply's connection.
 * @param target - The seed applied.
 * @throws {Error} naming the changes still planned.
 * @sideEffect Reads the catalog.
 */
async function readBackMatches(client: SeedClient, target: CatalogContent): Promise<void> {
    const plan = buildCatalogPlan(target, await new CatalogSnapshotDao(client).read(), NO_CHANGES);

    if (!isEmptyPlan(plan)) {
        throw new Error(`the catalog read back differs from the seed: ${JSON.stringify(plan.changes.slice(0, 10))}`);
    }
}

/** What a case changes about one apply. */
interface ApplyHooks {
    readonly prepare?: (client: SeedClient) => Promise<void>;
    /** Replaces the read-back check. */
    readonly check?: (client: SeedClient) => Promise<void>;
    /** Runs on the apply's connection once the apply has returned. */
    readonly after?: (client: SeedClient) => Promise<void>;
}

/**
 * Apply a seed on a connection opened for it alone, as the seeder.
 *
 * @param target - The seed's content.
 * @param seedSha - Its digest.
 * @param hooks - What the case changes.
 * @returns What the apply did.
 * @sideEffect Connects as `food_seeder` and writes the catalog.
 */
async function applySeed(target: CatalogContent, seedSha: string, hooks: ApplyHooks = {}): Promise<CatalogSeedResult> {
    const client = new pg.Client({ connectionString: seedDb.seederUrl });

    await client.connect();

    try {
        const result = await applyCatalogSeed({
            session: pgSeedSession(client),
            snapshot: new CatalogSnapshotDao(client),
            verify: {
                prepare: async () => hooks.prepare?.(client),
                check: async () => (hooks.check ?? ((c: SeedClient) => readBackMatches(c, target)))(client),
            },
            target,
            changes: NO_CHANGES,
            seedSha,
            log: () => undefined,
        });

        await hooks.after?.(client);

        return result;
    } finally {
        await client.end();
    }
}

/**
 * Run a statement as the owner.
 *
 * @param sql - The statement.
 * @param values - Its values.
 * @returns Its rows.
 * @sideEffect Connects as the owner.
 */
async function asOwner<Row extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<Row[]> {
    return seedDb.asOwner(async (client) => (await client.query<Row>(sql, values)).rows);
}

/**
 * Every seed root's and variant's id, live or retired.
 *
 * @returns The ids by natural key.
 * @sideEffect Reads the catalog as the owner.
 */
async function seedIds(): Promise<SeedIds> {
    const roots = await asOwner<{ seed_key: string; id: string }>(
        'SELECT seed_key, id FROM food WHERE seed_key IS NOT NULL',
    );
    const variants = await asOwner<{ natural_key: string; id: string }>(
        'SELECT i.natural_key, v.id FROM food_variant v JOIN food_item i ON i.id = v.item_id',
    );

    return {
        roots: Object.fromEntries(roots.map((row) => [row.seed_key, row.id])),
        variants: Object.fromEntries(variants.map((row) => [row.natural_key, row.id])),
    };
}

/**
 * The ledger's digests, oldest first.
 *
 * @returns The digests.
 * @sideEffect Reads the ledger as the owner.
 */
async function ledger(): Promise<string[]> {
    return (await asOwner<{ seed_sha: string }>('SELECT seed_sha FROM catalog_seed_ledger ORDER BY id')).map(
        (row) => row.seed_sha,
    );
}

/**
 * The catalog as the snapshot DAO reads it, outside any apply.
 *
 * @returns The snapshot.
 * @sideEffect Reads the catalog as the seeder.
 */
async function snapshotNow(): Promise<CatalogSnapshot> {
    const client = new pg.Client({ connectionString: seedDb.seederUrl });

    await client.connect();

    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

        return await new CatalogSnapshotDao(client).read();
    } finally {
        await client.query('ROLLBACK');
        await client.end();
    }
}

/**
 * Whether a catalog holds exactly a seed's content, live.
 *
 * @param target - The seed.
 * @returns `true` when the seed plans as nothing to do against the catalog.
 * @sideEffect Reads the catalog.
 */
async function holds(target: CatalogContent): Promise<boolean> {
    return isEmptyPlan(buildCatalogPlan(target, await snapshotNow(), NO_CHANGES));
}

describe('the catalog seed, applied as food_seeder', () => {
    beforeAll(async () => {
        seedDb = await provisionRoleDatabase(foodDbSpec(SEED_APPLY_DATABASE));
    }, 120_000);

    beforeEach(async () => {
        await seedDb.truncate();
    });

    describe('the committed seed (AE5)', () => {
        let committed: CatalogContent;

        beforeAll(async () => {
            committed = projectSeed(composeSeedImage(await loadSeedSources(DATA_DIR))).content;
        }, 120_000);

        it('applies to an empty database, and a second run writes nothing and only verifies', async () => {
            const logged: Readonly<Record<string, unknown>>[] = [];

            const run = async (sha: string): Promise<CatalogSeedResult> => {
                const client = new pg.Client({ connectionString: seedDb.seederUrl });

                await client.connect();

                try {
                    return await runCatalogSeed({
                        client,
                        dataDir: DATA_DIR,
                        seedSha: sha,
                        verify: { prepare: async () => undefined, check: async (c) => readBackMatches(c, committed) },
                        log: (_message, attributes) => {
                            logged.push(attributes);
                        },
                    });
                } finally {
                    await client.end();
                }
            };

            const first = await run(SHA_A);
            const second = await run(SHA_A);

            expect(first.outcome).toBe('applied');
            expect(second.outcome).toBe('unchanged');
            expect(second.counts).toEqual({});
            expect(await ledger()).toEqual([SHA_A]);
            // KTD-1 picks the seed's shape from the apply's time, which the one log line carries.
            expect(logged.map((attributes) => attributes['outcome'])).toEqual(['applied', 'unchanged']);
            expect(logged[0]?.['transactionMs']).toBe(first.timings.transactionMs);
            expect(first.timings.writeMs).toBeGreaterThan(0);
        }, 600_000);
    });

    describe('seed A, then B, then A again (R33)', () => {
        it('restores every id, clears every retirement, and leaves forwards that resolve to live rows', async () => {
            await applySeed(SEED_A, SHA_A);
            const afterA = await seedIds();

            expect(await holds(SEED_A)).toBe(true);

            const toB = await applySeed(SEED_B, SHA_B);
            const afterB = await seedIds();

            expect(toB.outcome).toBe('applied');
            expect(await holds(SEED_B)).toBe(true);
            // A rename keeps the root's id (AE4); the split keeps the original root and its other variants.
            expect(afterB.roots['fdc:100']).toBe(afterA.roots['fdc:100']);
            expect(afterB.variants['fdc:101']).toBe(afterA.variants['fdc:101']);
            // Retired rows keep their ids, their items and their numbers.
            expect(
                await asOwner<{ seed_key: string; retired: boolean; values: string }>(
                    `SELECT f.seed_key, f.retired_at IS NOT NULL AS retired,
                            (SELECT count(*) FROM food_nutrition h JOIN food_nutrition_value v ON v.nutrition_id = h.id
                              WHERE h.food_id = f.id)::text AS values
                       FROM food f WHERE f.seed_key = 'fdc:300'`,
                ),
            ).toEqual([{ seed_key: 'fdc:300', retired: true, values: '1' }]);
            expect(
                await asOwner<{ natural_key: string }>(
                    `SELECT i.natural_key FROM food_variant v JOIN food_item i ON i.id = v.item_id
                      WHERE v.retired_at IS NOT NULL ORDER BY 1`,
                ),
            ).toEqual([{ natural_key: 'fdc:103' }, { natural_key: 'fdc:301' }]);
            // The merged root forwards to the survivor; the promoted variant forwards to its new root.
            expect(
                await asOwner<{ source_id: string; target_food_id: string | null }>(
                    'SELECT source_id, target_food_id FROM food_forward ORDER BY source_id',
                ),
            ).toEqual(
                [
                    { source_id: afterA.roots['fdc:200'], target_food_id: afterA.roots['fdc:100'] },
                    { source_id: afterA.variants['fdc:102'], target_food_id: afterB.roots['fdc:102'] },
                ].sort((left, right) => String(left.source_id).localeCompare(String(right.source_id))),
            );

            const backToA = await applySeed(SEED_A, SHA_A);
            const afterAgain = await seedIds();

            expect(backToA.outcome).toBe('applied');
            expect(await holds(SEED_A)).toBe(true);
            expect(afterAgain.roots).toMatchObject(afterA.roots);
            expect(afterAgain.variants).toMatchObject(afterA.variants);
            expect(await asOwner('SELECT id FROM food WHERE seed_key IS NOT NULL AND retired_at IS NOT NULL')).toEqual(
                [],
            );
            expect(await asOwner('SELECT id FROM food_variant WHERE retired_at IS NOT NULL')).toEqual([]);
            // Every forward resolves to a live root or variant, and B's own rows now forward back.
            expect(
                await asOwner<{ dangling: string }>(
                    `SELECT w.source_id AS dangling FROM food_forward w
                       LEFT JOIN food f ON f.id = w.target_food_id AND f.retired_at IS NULL
                       LEFT JOIN food_variant v ON v.id = w.target_variant_id AND v.retired_at IS NULL
                      WHERE f.id IS NULL AND v.id IS NULL`,
                ),
            ).toEqual([]);
            expect(
                (await asOwner<{ source_id: string }>('SELECT source_id FROM food_forward'))
                    .map((row) => row.source_id)
                    .sort(),
            ).toEqual([afterB.roots['fdc:102'], afterB.variants['fdc:200']].sort());
            expect(await ledger()).toEqual([SHA_A, SHA_B, SHA_A]);

            expect((await applySeed(SEED_A, SHA_A)).outcome).toBe('unchanged');
        }, 120_000);
    });

    describe('a root whose elected item changes (KTD-8)', () => {
        it('keeps the root’s key and id, forwards the variant it displaced, and gives its old item to another root', async () => {
            await applySeed(SEED_A, SHA_A);

            const before = await seedIds();
            // Brisket's elected item becomes the flat's; brisket's old item becomes a variant of chicken. The flat's item
            // flips to a root's once the flat is gone, and brisket's old item only once brisket has moved off it.
            const elected = makeContent(
                [{ ...BRISKET, item: 'fdc:101', nutrition: makeNutrition('fdc:101') }, CHICKEN, VEAL, SALT, MYSTERY],
                [
                    POINT,
                    TRIMMED,
                    VEAL_LOIN,
                    makeContentVariant({
                        item: 'fdc:100',
                        root: 'fdc:200',
                        parts: [{ attribute: 'formOrVariety', text: 'brisket' }],
                        nutrition: makeNutrition('fdc:100'),
                    }),
                ],
                [{ ...BRISKET_ITEM, portions: [], categories: [] }, SALT_ITEM],
            );

            expect((await applySeed(elected, SHA_B)).outcome).toBe('applied');

            const after = await seedIds();

            expect(await holds(elected)).toBe(true);
            expect(after.roots['fdc:100']).toBe(before.roots['fdc:100']);
            expect(
                await asOwner<{ owner_kind: string }>("SELECT owner_kind FROM food_item WHERE natural_key = 'fdc:100'"),
            ).toEqual([{ owner_kind: 'variant' }]);
            expect(
                await asOwner<{ target_food_id: string }>(
                    'SELECT target_food_id FROM food_forward WHERE source_id = $1',
                    [before.variants['fdc:101']],
                ),
            ).toEqual([{ target_food_id: before.roots['fdc:100'] }]);
        }, 60_000);
    });

    describe('two applies at once (KTD-2)', () => {
        it('records one ledger row, and the second plans against the first one’s committed rows', async () => {
            let release: () => void = () => undefined;
            const firstHoldsLock = new Promise<void>((resolve) => {
                release = resolve;
            });
            const first = applySeed(SEED_A, SHA_A, {
                prepare: async () => {
                    release();
                },
                check: async (client) => {
                    await new Promise((resolve) => setTimeout(resolve, 1_500));
                    await readBackMatches(client, SEED_A);
                },
            });

            await firstHoldsLock;

            const second = applySeed(SEED_A, SHA_A);
            const [one, two] = await Promise.all([first, second]);

            expect([one.outcome, two.outcome]).toEqual(['applied', 'unchanged']);
            expect(two.timings.lockWaitMs).toBeGreaterThan(1_000);
            expect(await ledger()).toEqual([SHA_A]);
        }, 60_000);
    });

    describe('a failure halfway (R32, R37)', () => {
        it('leaves the previous seed and ledger when a statement falls short, and a re-run after the fix completes', async () => {
            const withNewNutrient = makeContent(
                [
                    ...SEED_A.roots.values(),
                    makeContentRoot({
                        seedKey: 'fdc:500',
                        name: 'oat bran',
                        item: 'fdc:500',
                        nutrition: {
                            ...makeNutrition('fdc:500'),
                            values: [{ name: 'Carbohydrate, by difference', unit: 'g', amount: '66' }],
                        },
                    }),
                ],
                [...SEED_A.variants.values()],
                [...SEED_A.items.values()],
            );

            await applySeed(SEED_A, SHA_A);

            const before = await seedIds();

            // A dictionary entry holding the seeded tag under another name: the seed's insert of its own entry is skipped,
            // so the value join falls short AFTER the new item, root and source rows are written.
            await asOwner(
                "INSERT INTO nutrient (id, name, unit, infoods_tag) VALUES ('bogus', 'Carbs (bogus)', 'g', 'CHOCDF')",
            );

            await expect(applySeed(withNewNutrient, SHA_B)).rejects.toSatisfy(
                (error: unknown) => isCatalogApplyError(error) && error.where === 'valueInsert',
            );
            expect(await holds(SEED_A)).toBe(true);
            expect(await seedIds()).toEqual(before);
            expect(await ledger()).toEqual([SHA_A]);

            await asOwner("DELETE FROM nutrient WHERE id = 'bogus'");

            expect((await applySeed(withNewNutrient, SHA_B)).outcome).toBe('applied');
            expect(await holds(withNewNutrient)).toBe(true);
            expect(await ledger()).toEqual([SHA_A, SHA_B]);
        }, 60_000);

        it('rolls back every write when the verifier fails, and records nothing', async () => {
            await applySeed(SEED_A, SHA_A);

            const failure = new Error('variant fdc:101 is missing');

            await expect(
                applySeed(SEED_B, SHA_B, {
                    check: async () => {
                        throw failure;
                    },
                }),
            ).rejects.toBe(failure);
            expect(await holds(SEED_A)).toBe(true);
            expect(await ledger()).toEqual([SHA_A]);
        }, 60_000);
    });

    describe('the transaction’s own settings (KTD-2)', () => {
        it('holds the three timeouts and the search path inside the transaction, and none after it', async () => {
            const settingsOf = async (client: SeedClient): Promise<Record<string, string>> =>
                Object.fromEntries(
                    (
                        await client.query<{ name: string; value: string }>(
                            `SELECT name, current_setting(name) AS value FROM unnest(ARRAY[
                                 'statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout', 'search_path'
                             ]) AS name`,
                        )
                    ).rows.map((row) => [row.name, row.value]),
                );
            const inMs = async (client: SeedClient): Promise<Record<string, string>> =>
                Object.fromEntries(
                    (
                        await client.query<{ name: string; setting: string }>(
                            `SELECT name, setting FROM pg_settings
                              WHERE name IN ('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout')`,
                        )
                    ).rows.map((row) => [row.name, row.setting]),
                );
            let inside: Record<string, string> = {};
            let insideMs: Record<string, string> = {};
            let after: Record<string, string> = {};
            let before: Record<string, string> = {};

            await applySeed(SEED_A, SHA_A, {
                prepare: async (client) => {
                    before = await settingsOf(client);
                },
                check: async (client) => {
                    inside = await settingsOf(client);
                    insideMs = await inMs(client);
                    await readBackMatches(client, SEED_A);
                },
                after: async (client) => {
                    after = await settingsOf(client);
                },
            });

            expect(insideMs).toEqual({
                statement_timeout: String(SEED_STATEMENT_TIMEOUT_MS),
                lock_timeout: String(SEED_LOCK_TIMEOUT_MS),
                idle_in_transaction_session_timeout: String(SEED_IDLE_IN_TRANSACTION_TIMEOUT_MS),
            });
            expect(inside['search_path']).toBe('pg_catalog, public, pg_temp');
            expect(after).toEqual(before);
            expect(after['statement_timeout']).not.toBe(inside['statement_timeout']);
        }, 60_000);

        it('writes the catalog, never a temp table that shadows it, when the verifier has made one', async () => {
            await applySeed(SEED_A, SHA_A, {
                prepare: async (client) => {
                    await client.query('CREATE TEMP TABLE food (id text, seed_key text, name text)');
                    await client.query('CREATE TEMP TABLE food_item (id text, natural_key text)');
                },
                check: async (client) => {
                    expect((await client.query('SELECT * FROM pg_temp.food')).rows).toEqual([]);
                    expect((await client.query('SELECT * FROM pg_temp.food_item')).rows).toEqual([]);
                    await readBackMatches(client, SEED_A);
                },
            });

            expect(await holds(SEED_A)).toBe(true);
        }, 60_000);
    });

    describe('foods the seed does not own (KTD-12)', () => {
        let app: pg.Pool;

        beforeAll(() => {
            app = new pg.Pool({ connectionString: seedDb.appUrl, max: 2 });
        });

        afterAll(async () => {
            await app.end();
        });

        it('retires and forwards a live food whose name a new seed root claims, and the next deploy writes nothing', async () => {
            await applySeed(SEED_A, SHA_A);

            const live = await makeCatalogFood(app, { name: 'chicken thigh' });
            const withThigh = makeContent(
                [
                    ...SEED_A.roots.values(),
                    makeContentRoot({
                        seedKey: 'fdc:210',
                        name: 'Chicken Thigh',
                        item: 'fdc:210',
                        nutrition: makeNutrition('fdc:210'),
                    }),
                ],
                [...SEED_A.variants.values()],
                [...SEED_A.items.values()],
            );

            expect((await applySeed(withThigh, SHA_B)).outcome).toBe('applied');

            const thigh = (await seedIds()).roots['fdc:210'];

            expect(
                await asOwner<{ retired: boolean; target: string }>(
                    `SELECT f.retired_at IS NOT NULL AS retired, w.target_food_id AS target
                       FROM food f JOIN food_forward w ON w.source_id = f.id WHERE f.id = $1`,
                    [live.id],
                ),
            ).toEqual([{ retired: true, target: thigh }]);
            expect((await applySeed(withThigh, SHA_B)).outcome).toBe('unchanged');
        }, 60_000);

        it('takes over a Foundation key a live food holds: releases its rows, retires and forwards it', async () => {
            await applySeed(SEED_A, SHA_A);

            const live = await makeCatalogFood(app, { name: 'shiitake' });
            const sourceId = `source-${randomUUID()}`;

            await app.query(
                "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, 'usda', '400')",
                [sourceId, live.itemId],
            );
            await app.query(
                "INSERT INTO food_portions (id, item_id, label, gram_weight, source_id) VALUES ($1, $2, '1 cup', 70, $3)",
                [`portion-${randomUUID()}`, live.itemId, sourceId],
            );
            await app.query("INSERT INTO food_category (id, name) VALUES ('category-veg', 'Vegetables')");
            await app.query(
                "INSERT INTO food_category_assignment (item_id, category_id, source_id) VALUES ($1, 'category-veg', $2)",
                [live.itemId, sourceId],
            );
            await app.query("INSERT INTO food_field_provenance (item_id, field, source_id) VALUES ($1, 'name', $2)", [
                live.itemId,
                sourceId,
            ]);

            const withShiitake = makeContent(
                [
                    ...SEED_A.roots.values(),
                    makeContentRoot({
                        seedKey: 'fdc:400',
                        name: 'shiitake mushrooms, raw',
                        item: 'fdc:400',
                        nutrition: makeNutrition('fdc:400'),
                    }),
                ],
                [...SEED_A.variants.values()],
                [...SEED_A.items.values()],
            );

            expect((await applySeed(withShiitake, SHA_B)).outcome).toBe('applied');

            const root = (await seedIds()).roots['fdc:400'];

            expect(
                await asOwner<{ retired: boolean; target: string }>(
                    `SELECT f.retired_at IS NOT NULL AS retired, w.target_food_id AS target
                       FROM food f JOIN food_forward w ON w.source_id = f.id WHERE f.id = $1`,
                    [live.id],
                ),
            ).toEqual([{ retired: true, target: root }]);
            expect(
                await asOwner<{ rows: string }>(
                    `SELECT ((SELECT count(*) FROM food_sources WHERE item_id = $1)
                           + (SELECT count(*) FROM food_portions WHERE item_id = $1)
                           + (SELECT count(*) FROM food_category_assignment WHERE item_id = $1)
                           + (SELECT count(*) FROM food_field_provenance WHERE item_id = $1))::text AS rows`,
                    [live.itemId],
                ),
            ).toEqual([{ rows: '0' }]);
            expect(
                await asOwner<{ natural_key: string }>(
                    `SELECT i.natural_key FROM food_sources s JOIN food_item i ON i.id = s.item_id
                      WHERE s.source = 'usda' AND s.external_key = '400'`,
                ),
            ).toEqual([{ natural_key: 'fdc:400' }]);
            // A new digest over the same rows records itself without writing a row; the one after that only verifies.
            expect(await applySeed(withShiitake, SHA_C)).toMatchObject({ outcome: 'applied', changes: 0, counts: {} });
            expect((await applySeed(withShiitake, SHA_C)).outcome).toBe('unchanged');
        }, 60_000);

        it('leaves an authored food and an unclaimed live food exactly as they were', async () => {
            const authored = await makeCatalogFood(app, { name: 'beef brisket', userId: 'user-author' });
            const live = await makeCatalogFood(app, { name: 'table salt' });
            const rowsOf = async (): Promise<unknown[]> =>
                asOwner(
                    `SELECT to_jsonb(f) AS food, to_jsonb(i) AS item FROM food f JOIN food_item i ON i.id = f.item_id
                      WHERE f.id = ANY($1::text[]) ORDER BY f.id`,
                    [[authored.id, live.id]],
                );
            const before = await rowsOf();

            await applySeed(SEED_A, SHA_A);

            expect(await rowsOf()).toEqual(before);
            expect(await holds(SEED_A)).toBe(true);
        }, 60_000);
    });
});
