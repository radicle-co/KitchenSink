/**
 * LOCAL e2e: the item-keyed catalog schema on a database migrated by food's own runner (curated catalog plan U4,
 * KTD-6, KTD-7, KTD-8, KTD-12, KTD-13, KTD-14, KTD-19).
 *
 * Three principals try every statement: `food_app` (the service), `food_seeder` (the seed) and the owner (a
 * migration). The ownership trigger decides by `session_user` and by the changed rows' item, so each case runs one
 * statement against a seed-owned world and an authored world and rolls it back.
 *
 * Every authorization refusal is asserted by SQLSTATE `42501` and every integrity refusal by its own class, so a
 * statement that fails for another reason, such as a typo or a missing column, cannot pass as a refusal.
 */
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

import { FOOD_CATALOG_REGISTRY, FOOD_TABLE_POLICY } from '../../src/db/schema/catalog.js';
import { catalogPartitionProblems } from '../../src/db/schema/catalogPartition.js';
import { VARIANT_ATTRIBUTES } from '../../src/foods/foods.schema.js';
import { CITATION_MATCHES } from '../../src/foods/seed/catalog/citationPrecedence.js';
import { isSeedKey } from '../../src/foods/seed/catalogKey.js';
import { CITATION_DATASETS } from '../../src/foods/seed/citationDatasets.js';
import { REGISTERED_SOURCE_IDS } from '../../src/sources/sourceRegister.js';
import { foodDb } from '../support/roleDb.js';
import {
    insertCitation,
    insertHeader,
    insertItem,
    insertNutrient,
    insertRoot,
    makeCatalogWorld,
    newId,
    nextNumber,
    WORLD_AUTHOR,
    type AuthoredWorld,
    type CatalogWorld,
    type SeedWorld,
} from './__fixtures__/catalogWorld.js';

/** Who runs a statement. */
type Subject = 'app' | 'seeder' | 'owner';

/** One statement with its parameters. */
type Statement = readonly [sql: string, params: readonly unknown[]];

/**
 * The seed's own last statement: a ledger row, as the apply appends one after its verifier passes (KTD-4). A seeder
 * transaction that changes catalog rows commits only with one (0021), so every committed seeder case here carries it
 * and can fail only for the reason it names.
 */
const recordSeed = (): Statement => [
    'INSERT INTO catalog_seed_ledger (seed_sha) VALUES ($1)',
    [nextNumber().toString(16).padStart(64, '0')],
];

/** Append a ledger row as the owner, committed, as an earlier seed (or a migration) leaves one. */
async function recordSeedAsOwner(): Promise<void> {
    const [sql, values] = recordSeed();

    await foodDb().asOwner((client) => client.query(sql, [...values]));
}

/** The SQLSTATE a statement failed with, or `undefined` when it succeeded. */
async function sqlStateOf(client: pg.ClientBase, [sql, params]: Statement): Promise<string | undefined> {
    try {
        await client.query(sql, [...params]);

        return undefined;
    } catch (error) {
        return (error as { code?: string }).code ?? 'no-code';
    }
}

/**
 * Run statements in one transaction as a subject, then roll back, and report the first failure's SQLSTATE.
 *
 * @param subject - Who runs them.
 * @param statements - The statements, in order.
 * @param commit - Commit instead of rolling back, so a deferred constraint is checked.
 * @returns The first SQLSTATE, or `undefined` when all succeeded.
 */
async function attempt(
    subject: Subject,
    statements: readonly Statement[],
    commit = false,
): Promise<string | undefined> {
    const run = async (client: pg.ClientBase): Promise<string | undefined> => {
        await client.query('BEGIN');

        try {
            for (const statement of statements) {
                const state = await sqlStateOf(client, statement);

                if (state !== undefined) {
                    return state;
                }
            }

            if (commit) {
                return await sqlStateOf(client, ['COMMIT', []]);
            }

            return undefined;
        } finally {
            await client.query('ROLLBACK');
        }
    };

    if (subject === 'owner') {
        return foodDb().asOwner(run);
    }

    const client = new pg.Client({ connectionString: subject === 'app' ? foodDb().appUrl : foodDb().seederUrl });

    await client.connect();

    try {
        return await run(client);
    } finally {
        await client.end();
    }
}

/** One case per guarded table and event: an INSERT, an UPDATE and a DELETE that are valid against a world. */
type GuardedCases<W> = Readonly<Record<string, Readonly<Record<'INSERT' | 'UPDATE' | 'DELETE', (w: W) => Statement>>>>;

const author = (w: CatalogWorld): string | null => (w.kind === 'seed' ? null : WORLD_AUTHOR);

const GUARDED_CASES: GuardedCases<CatalogWorld> = {
    food_item: {
        INSERT: (w) => [
            "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ($1, $2, 'root')",
            [newId('item'), w.kind === 'seed' ? `fdc:${nextNumber()}` : null],
        ],
        UPDATE: (w) => ['UPDATE food_item SET created_at = created_at WHERE id = $1', [w.item]],
        DELETE: (w) => ['DELETE FROM food_item WHERE id = $1', [w.spareRootItem]],
    },
    food: {
        INSERT: (w) => [
            `INSERT INTO food (id, item_id, name, normalized_name, seed_key, user_id, visibility)
             VALUES ($1, $2, $3, $3, $4, $5, $6)`,
            [
                newId('food'),
                w.spareRootItem,
                `inserted ${nextNumber()}`,
                w.kind === 'seed' ? `curated:inserted-${nextNumber()}` : null,
                author(w),
                w.kind === 'seed' ? 'public' : 'private',
            ],
        ],
        UPDATE: (w) => ['UPDATE food SET name = name WHERE id = $1', [w.root]],
        DELETE: (w) => ['DELETE FROM food WHERE id = $1', [w.root2]],
    },
    food_sources: {
        INSERT: (w) => [
            "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, 'usda', $3)",
            [newId('source'), w.item, String(nextNumber())],
        ],
        UPDATE: (w) => ['UPDATE food_sources SET fetched_at = fetched_at WHERE id = $1', [w.source]],
        DELETE: (w) => ['DELETE FROM food_sources WHERE id = $1', [w.source2]],
    },
    food_field_provenance: {
        INSERT: (w) => [
            "INSERT INTO food_field_provenance (item_id, field, source_id) VALUES ($1, 'description', $2)",
            [w.item, w.source],
        ],
        UPDATE: (w) => ['UPDATE food_field_provenance SET source_id = source_id WHERE item_id = $1', [w.item]],
        DELETE: (w) => ['DELETE FROM food_field_provenance WHERE item_id = $1', [w.item]],
    },
    food_category_assignment: {
        INSERT: (w) => [
            'INSERT INTO food_category_assignment (item_id, category_id) VALUES ($1, $2)',
            [w.item, w.category2],
        ],
        UPDATE: (w) => ['UPDATE food_category_assignment SET source_id = source_id WHERE item_id = $1', [w.item]],
        DELETE: (w) => ['DELETE FROM food_category_assignment WHERE item_id = $1', [w.item]],
    },
    food_nutrition: {
        // A seed world's header goes on its variant, so the resolver's variant arm is decided too; an authored root
        // has no variant (R40), so its header goes on the bare root.
        INSERT: (w) =>
            w.kind === 'seed'
                ? ['INSERT INTO food_nutrition (id, food_variant_id) VALUES ($1, $2)', [newId('nutrition'), w.variant]]
                : ['INSERT INTO food_nutrition (id, food_id) VALUES ($1, $2)', [newId('nutrition'), w.bareRoot]],
        UPDATE: (w) => ['UPDATE food_nutrition SET food_id = food_id WHERE id = $1', [w.nutrition]],
        DELETE: (w) => ['DELETE FROM food_nutrition WHERE id = $1', [w.nutrition]],
    },
    food_nutrition_citation: {
        INSERT: (w) => [
            `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
             VALUES ($1, $2, 'usdaFndds', $3, 'close')`,
            [newId('citation'), w.nutrition, String(nextNumber())],
        ],
        UPDATE: (w) => ['UPDATE food_nutrition_citation SET external_key = external_key WHERE id = $1', [w.citation]],
        DELETE: (w) => ['DELETE FROM food_nutrition_citation WHERE id = $1', [w.citation2]],
    },
    food_nutrition_value: {
        INSERT: (w) => [
            `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id)
             VALUES ($1, $2, 1.5, 'per_100g', $3)`,
            [w.nutrition, w.nutrient2, w.citation],
        ],
        UPDATE: (w) => ['UPDATE food_nutrition_value SET amount = amount WHERE nutrition_id = $1', [w.nutrition]],
        DELETE: (w) => ['DELETE FROM food_nutrition_value WHERE nutrition_id = $1', [w.nutrition]],
    },
    food_portions: {
        INSERT: (w) => [
            "INSERT INTO food_portions (id, item_id, label, gram_weight, source_id) VALUES ($1, $2, 'slice', 30, $3)",
            [newId('portion'), w.item, w.source],
        ],
        UPDATE: (w) => ['UPDATE food_portions SET label = label WHERE id = $1', [w.portion]],
        DELETE: (w) => ['DELETE FROM food_portions WHERE id = $1', [w.portion]],
    },
};

/**
 * The tables whose rows hang off a variant. Only a seed world has one, since an authored root never gets a variant
 * (R40), so these run against the seed world; the R40 cases below decide the authored side.
 */
const VARIANT_CASES: GuardedCases<SeedWorld> = {
    food_variant: {
        INSERT: (w) => [
            'INSERT INTO food_variant (id, food_id, item_id) VALUES ($1, $2, $3)',
            [newId('variant'), w.root, w.spareVariantItem],
        ],
        UPDATE: (w) => ['UPDATE food_variant SET created_at = created_at WHERE id = $1', [w.variant]],
        DELETE: (w) => ['DELETE FROM food_variant WHERE id = $1', [w.variant]],
    },
    food_variant_part: {
        INSERT: (w) => [
            "INSERT INTO food_variant_part (variant_id, attribute, ordinal, text) VALUES ($1, 'bone', 0, 'bone-in')",
            [w.variant],
        ],
        UPDATE: (w) => ['UPDATE food_variant_part SET text = text WHERE variant_id = $1', [w.variant]],
        DELETE: (w) => ['DELETE FROM food_variant_part WHERE variant_id = $1', [w.variant]],
    },
};

const EVENTS = ['INSERT', 'UPDATE', 'DELETE'] as const;

describe('the item-keyed catalog schema', () => {
    let seed: SeedWorld;
    let authored: AuthoredWorld;

    beforeEach(async () => {
        await foodDb().truncate();
        // Built as the owner, whom the ownership trigger admits.
        seed = await foodDb().asOwner((client) => makeCatalogWorld(client, 'seed'));
        authored = await foodDb().asOwner((client) => makeCatalogWorld(client, 'authored'));
    });

    afterAll(async () => {
        await foodDb().truncate();
    });

    describe('the ownership trigger, for every guarded table and event', () => {
        let guarded: readonly string[];

        beforeAll(async () => {
            guarded = await foodDb().asOwner(async (client) => {
                const found = await client.query<{ table: string }>(
                    `SELECT DISTINCT c.relname AS table FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                      WHERE t.tgfoid = 'public.catalog_guard'::regproc AND NOT t.tgisinternal ORDER BY 1`,
                );

                return found.rows.map((row) => row.table);
            });
        });

        it('guards exactly the catalog tables that have a case here, on every event', async () => {
            expect(guarded).toStrictEqual(Object.keys({ ...GUARDED_CASES, ...VARIANT_CASES }).sort());

            const events = await foodDb().asOwner(async (client) => {
                const found = await client.query<{ table: string; events: number }>(
                    `SELECT c.relname AS table, count(*)::int AS events FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                      WHERE t.tgfoid = 'public.catalog_guard'::regproc GROUP BY 1`,
                );

                return found.rows;
            });

            expect(events.every((row) => row.events === EVENTS.length)).toBe(true);
            // Every catalog table but the forward table carries this trigger; the forward table has its own.
            expect([...FOOD_TABLE_POLICY.catalog].filter((table) => table !== 'food_forward').sort()).toStrictEqual([
                ...guarded,
            ]);
        });

        const matrix = Object.keys(GUARDED_CASES).flatMap((table) => EVENTS.map((event) => [table, event] as const));

        it.each(matrix)('%s %s: refuses food_app on a seed-owned row', async (table, event) => {
            expect(await attempt('app', [GUARDED_CASES[table]![event](seed)])).toBe('42501');
        });

        it.each(matrix)('%s %s: admits food_seeder on a seed-owned row', async (table, event) => {
            expect(await attempt('seeder', [GUARDED_CASES[table]![event](seed)])).toBeUndefined();
        });

        it.each(matrix)('%s %s: admits the owner on a seed-owned row', async (table, event) => {
            expect(await attempt('owner', [GUARDED_CASES[table]![event](seed)])).toBeUndefined();
        });

        it.each(matrix)('%s %s: refuses food_seeder on an authored row', async (table, event) => {
            expect(await attempt('seeder', [GUARDED_CASES[table]![event](authored)])).toBe('42501');
        });

        it.each(matrix)('%s %s: admits food_app on an authored row (positive control)', async (table, event) => {
            expect(await attempt('app', [GUARDED_CASES[table]![event](authored)])).toBeUndefined();
        });

        const variantMatrix = Object.keys(VARIANT_CASES).flatMap((table) =>
            EVENTS.map((event) => [table, event] as const),
        );

        it.each(variantMatrix)('%s %s: refuses food_app on a seed-owned row', async (table, event) => {
            expect(await attempt('app', [VARIANT_CASES[table]![event](seed)])).toBe('42501');
        });

        it.each(variantMatrix)('%s %s: admits food_seeder on a seed-owned row', async (table, event) => {
            expect(await attempt('seeder', [VARIANT_CASES[table]![event](seed)])).toBeUndefined();
        });

        it.each(variantMatrix)('%s %s: admits the owner on a seed-owned row', async (table, event) => {
            expect(await attempt('owner', [VARIANT_CASES[table]![event](seed)])).toBeUndefined();
        });
    });

    describe('a variant belongs to the seed: its item is seed-owned and its root is unauthored (R40)', () => {
        // `check_violation`, not `42501`: this is a fact about the data, so it binds every writer, the owner too.
        const variantOf = (root: string, item: string): Statement => [
            'INSERT INTO food_variant (id, food_id, item_id) VALUES ($1, $2, $3)',
            [newId('variant'), root, item],
        ];

        it('refuses food_app a variant under an authored root', async () => {
            expect(await attempt('app', [variantOf(authored.root, authored.spareVariantItem)])).toBe('23514');
        });

        it.each(['seeder', 'owner'] as const)('refuses %s a seed-owned variant under an authored root', async (who) => {
            expect(await attempt(who, [variantOf(authored.root, seed.spareVariantItem)])).toBe('23514');
        });

        it.each(['app', 'owner'] as const)(
            'refuses %s a variant on an unseeded item under a seed root',
            async (who) => {
                expect(await attempt(who, [variantOf(seed.root, authored.spareVariantItem)])).toBe('23514');
            },
        );

        it('refuses the seeder moving a seed variant under an authored root', async () => {
            expect(
                await attempt('seeder', [
                    ['UPDATE food_variant SET food_id = $1 WHERE id = $2', [authored.root, seed.variant]],
                ]),
            ).toBe('23514');
        });

        it('still refuses the seeder when a temporary food table hides the author', async () => {
            expect(
                await attempt('seeder', [
                    ['CREATE TEMPORARY TABLE food AS SELECT id, item_id, NULL::text AS user_id FROM public.food', []],
                    variantOf(authored.root, seed.spareVariantItem),
                ]),
            ).toBe('23514');
        });

        it('admits the seeder a seed-owned variant under a seed root (positive control)', async () => {
            expect(await attempt('seeder', [variantOf(seed.root, seed.spareVariantItem)])).toBeUndefined();
        });
    });

    describe('an authored root never sits on a seed-owned item, whoever writes it', () => {
        it.each(['seeder', 'owner'] as const)('refuses %s an authored root on a seed-owned item', async (who) => {
            expect(
                await attempt(who, [
                    [
                        "INSERT INTO food (id, item_id, name, normalized_name, user_id, visibility) VALUES ($1, $2, $3, $3, $4, 'private')",
                        [newId('food'), seed.spareRootItem, `authored on seed ${nextNumber()}`, WORLD_AUTHOR],
                    ],
                ]),
            ).toBe('23514');
        });

        it('still refuses the seeder when a temporary food_item hides the seed ownership', async () => {
            expect(
                await attempt('seeder', [
                    [
                        'CREATE TEMPORARY TABLE food_item AS SELECT id, natural_key, false AS seed_owned, owner_kind FROM public.food_item',
                        [],
                    ],
                    [
                        "INSERT INTO food (id, item_id, name, normalized_name, user_id, visibility) VALUES ($1, $2, $3, $3, $4, 'private')",
                        [newId('food'), seed.spareRootItem, `shadowed ${nextNumber()}`, WORLD_AUTHOR],
                    ],
                ]),
            ).toBe('23514');
        });

        it('refuses the owner moving an authored root onto a seed-owned item', async () => {
            expect(
                await attempt('owner', [
                    ['UPDATE food SET item_id = $1 WHERE id = $2', [seed.spareRootItem, authored.bareRoot]],
                ]),
            ).toBe('23514');
        });
    });

    describe('the writer is judged by its session, not its current role (KTD-12)', () => {
        it('refuses a service write laundered through an owner-defined SECURITY DEFINER function', async () => {
            await foodDb().asOwner(async (client) => {
                await client.query(
                    `CREATE FUNCTION public.u4_launder(portion text) RETURNS void
                         LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
                         AS 'DELETE FROM public.food_portions WHERE id = $1'`,
                );
                await client.query(`GRANT EXECUTE ON FUNCTION public.u4_launder(text) TO ${DATABASE_ROLES.food.app}`);
            });

            try {
                expect(await attempt('app', [['SELECT public.u4_launder($1)', [seed.portion]]])).toBe('42501');
            } finally {
                await foodDb().asOwner((client) => client.query('DROP FUNCTION public.u4_launder(text)'));
            }
        });
    });

    describe('items and their owners', () => {
        it('refuses a second root on an item that already has one', async () => {
            expect(
                await attempt('owner', [
                    [
                        "INSERT INTO food (id, item_id, normalized_name, seed_key) VALUES ($1, $2, $3, 'curated:second-owner')",
                        [newId('food'), seed.item, `second ${nextNumber()}`],
                    ],
                ]),
            ).toBe('23505');
        });

        it('refuses a variant on a root item and a root on a variant item', async () => {
            expect(
                await attempt('owner', [
                    [
                        'INSERT INTO food_variant (id, food_id, item_id) VALUES ($1, $2, $3)',
                        [newId('variant'), seed.root, seed.spareRootItem],
                    ],
                ]),
            ).toBe('23503');
            expect(
                await attempt('owner', [
                    [
                        'INSERT INTO food (id, item_id, normalized_name) VALUES ($1, $2, $3)',
                        [newId('food'), seed.spareVariantItem, `kind ${nextNumber()}`],
                    ],
                ]),
            ).toBe('23503');
            expect(
                await attempt('owner', [
                    [
                        "INSERT INTO food (id, item_id, item_owner_kind, normalized_name) VALUES ($1, $2, 'variant', $3)",
                        [newId('food'), seed.spareVariantItem, `kind ${nextNumber()}`],
                    ],
                ]),
            ).toBe('23514');
        });

        it('keeps the item with its retired owner, so no second owner can take it', async () => {
            expect(
                await attempt('owner', [
                    ['UPDATE food SET retired_at = now() WHERE id = $1', [seed.root]],
                    [
                        'INSERT INTO food (id, item_id, normalized_name) VALUES ($1, $2, $3)',
                        [newId('food'), seed.item, `after retire ${nextNumber()}`],
                    ],
                ]),
            ).toBe('23505');
        });

        it('refuses deleting an item while its owner holds it', async () => {
            expect(await attempt('owner', [['DELETE FROM food_item WHERE id = $1', [seed.item]]])).toBe('23503');
        });

        it('lets the seeder insert an item and its root in one transaction', async () => {
            const itemId = newId('item');

            expect(
                await attempt(
                    'seeder',
                    [
                        [
                            "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ($1, 'curated:one-txn', 'root')",
                            [itemId],
                        ],
                        [
                            "INSERT INTO food (id, item_id, name, normalized_name, seed_key) VALUES ($1, $2, 'one txn', 'one txn', 'curated:one-txn')",
                            [newId('food'), itemId],
                        ],
                        recordSeed(),
                    ],
                    true,
                ),
            ).toBeUndefined();
        });

        it('never lets seed ownership change after insert', async () => {
            expect(
                await attempt('owner', [['UPDATE food_item SET natural_key = NULL WHERE id = $1', [seed.item]]]),
            ).toBe('23000');
            expect(
                await attempt('owner', [["UPDATE food_item SET natural_key = 'fdc:1' WHERE id = $1", [authored.item]]]),
            ).toBe('23000');
            expect(
                await attempt('owner', [['UPDATE food_item SET seed_owned = false WHERE id = $1', [seed.item]]]),
            ).toBe('428C9');
        });

        it('never lets a root change its author or its seed key', async () => {
            expect(
                await attempt('owner', [["UPDATE food SET user_id = 'someone' WHERE id = $1", [authored.root]]]),
            ).toBe('23000');
            expect(
                await attempt('owner', [["UPDATE food SET seed_key = 'curated:renamed' WHERE id = $1", [seed.root]]]),
            ).toBe('23000');
        });

        // Ids are never re-minted (ADR-0050 §4), and the ownership trigger pairs a food's old row to its new one by id.
        it.each(['seeder', 'owner'] as const)('never lets %s change a root’s id', async (who) => {
            expect(
                await attempt(who, [['UPDATE food SET id = $1 WHERE id = $2', [newId('food'), authored.bareRoot]]]),
            ).toBe('23000');
        });

        it('refuses the seeder an id change on its own, with the fixed-id trigger off', async () => {
            const live = await foodDb().asOwner(async (client) => {
                const id = await insertRoot(client, await insertItem(client, null, 'root'), {
                    seedKey: null,
                    userId: null,
                });

                await client.query('ALTER TABLE food DISABLE TRIGGER food_immutable');

                return id;
            });

            try {
                expect(
                    await attempt('seeder', [['UPDATE food SET id = $1 WHERE id = $2', [newId('food'), live]]]),
                ).toBe('42501');
            } finally {
                await foodDb().asOwner((client) => client.query('ALTER TABLE food ENABLE TRIGGER food_immutable'));
            }
        });

        it('stores natural and seed keys only in the seed format', async () => {
            const samples = [
                'fdc:1',
                'fdc:0',
                'fdc:01',
                'curated:beef-brisket',
                'curated:Beef',
                'curated:-a',
                'usda:1',
                '',
            ];

            for (const sample of samples) {
                const state = await attempt('owner', [
                    [
                        "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ($1, $2, 'root')",
                        [newId('item'), sample],
                    ],
                ]);

                expect({ sample, refused: state === '23514' }).toStrictEqual({ sample, refused: !isSeedKey(sample) });
            }
        });

        it('lets a retired root free its catalog name, and keeps live names unique', async () => {
            const name = `shared name ${nextNumber()}`;
            const first = await foodDb().asOwner(async (client) => {
                const itemId = await insertItem(client, null, 'root');

                return insertRoot(client, itemId, { seedKey: null, userId: null, name });
            });

            const insertSecond = async (): Promise<Statement> => {
                const itemId = await foodDb().asOwner((client) => insertItem(client, null, 'root'));

                return [
                    'INSERT INTO food (id, item_id, name, normalized_name) VALUES ($1, $2, $3, $3)',
                    [newId('food'), itemId, name],
                ];
            };

            expect(await attempt('app', [await insertSecond()])).toBe('23505');
            expect(
                await attempt('owner', [
                    ['UPDATE food SET retired_at = now() WHERE id = $1', [first]],
                    [
                        'INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ($1, $2, $3)',
                        [first, 'root', seed.root],
                    ],
                    await insertSecond(),
                ]),
            ).toBeUndefined();
        });
    });

    // Curated plan R19: a Foundation item's NDB number links its versions across USDA releases. The seed keeps the
    // live items' keys distinct; the schema admits a shared one, because an earlier version keeps its row once the
    // seed retires its owner (KTD-8).
    describe('a source row’s lineage key', () => {
        /** Insert one USDA-shaped source row on a seed item. */
        const sourceRow = (itemId: string, lineageKey: string | null, source = 'usda'): Statement => [
            'INSERT INTO food_sources (id, item_id, source, external_key, lineage_key) VALUES ($1, $2, $3, $4, $5)',
            [newId('source'), itemId, source, String(nextNumber()), lineageKey],
        ];

        it('admits a Foundation item’s lineage key, and no key at all', async () => {
            expect(
                await attempt('owner', [
                    sourceRow(seed.spareRootItem, 'foundation:11090'),
                    sourceRow(seed.spareRootItem, null),
                    sourceRow(seed.spareVariantItem, null),
                ]),
            ).toBeUndefined();
        });

        it('admits one lineage key on two rows: a food’s earlier version keeps its row', async () => {
            expect(
                await attempt('owner', [
                    sourceRow(seed.spareRootItem, 'foundation:11090'),
                    sourceRow(seed.spareVariantItem, 'foundation:11090'),
                ]),
            ).toBeUndefined();
        });

        it.each([
            'foundation:0',
            'foundation:011090',
            'foundation:',
            'foundation:11090 ',
            'FOUNDATION:11090',
            'srLegacy:11090',
            '',
        ])('refuses the lineage key %j', async (lineageKey) => {
            expect(await attempt('owner', [sourceRow(seed.spareRootItem, lineageKey)])).toBe('23514');
        });

        it('refuses a lineage key on a source other than USDA', async () => {
            expect(await attempt('owner', [sourceRow(seed.spareRootItem, 'foundation:11090', 'ciqual')])).toBe('23514');
        });
    });

    describe('a temporary table cannot shadow a relation a guard reads', () => {
        // The seeder holds TEMPORARY, and PostgreSQL searches `pg_temp` first for an unqualified relation unless the
        // function's search_path names it last. Each case builds a shadow that would flip the decision, then writes.
        const shadowCases: readonly (readonly [string, (s: SeedWorld, a: AuthoredWorld) => readonly Statement[]])[] = [
            [
                'pg_class, so the seeder reads as the owner',
                (_s, a) => [
                    ['CREATE TEMPORARY TABLE pg_class AS SELECT oid, relowner FROM pg_catalog.pg_class', []],
                    [
                        'UPDATE pg_temp.pg_class SET relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)',
                        [],
                    ],
                    ['UPDATE food SET name = name WHERE id = $1', [a.root]],
                ],
            ],
            [
                'food_item, so an authored item reads as seed-owned',
                (_s, a) => [
                    [
                        'CREATE TEMPORARY TABLE food_item AS SELECT id, natural_key, true AS seed_owned, owner_kind FROM public.food_item',
                        [],
                    ],
                    ['UPDATE food SET name = name WHERE id = $1', [a.root]],
                ],
            ],
            [
                "food, so an authored header's owner reads as a seed root",
                (s, a) => [
                    [
                        'CREATE TEMPORARY TABLE food AS SELECT id, $1::text AS item_id, user_id FROM public.food',
                        [s.item],
                    ],
                    ['UPDATE food_nutrition_value SET amount = amount WHERE nutrition_id = $1', [a.nutrition]],
                ],
            ],
            [
                'food, so an uncited value under a seed root reads as authored',
                (s) => [
                    [
                        "CREATE TEMPORARY TABLE food AS SELECT id, item_id, 'someone'::text AS user_id FROM public.food",
                        [],
                    ],
                    [
                        "INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis) VALUES ($1, $2, 1, 'per_100g')",
                        [s.nutrition, s.nutrient2],
                    ],
                ],
            ],
            [
                "food_nutrition, so an authored header's value reads as a seed root's",
                (s, a) => [
                    [
                        'CREATE TEMPORARY TABLE food_nutrition AS SELECT id, $1::text AS food_id, NULL::text AS food_variant_id FROM public.food_nutrition',
                        [s.root],
                    ],
                    ['UPDATE food_nutrition_value SET amount = amount WHERE nutrition_id = $1', [a.nutrition]],
                ],
            ],
        ];

        it.each(shadowCases)('still refuses the seeder with a shadow of %s', async (_case, build) => {
            expect(await attempt('seeder', build(seed, authored))).toMatch(/^(42501|23000)$/u);
        });

        it('still requires a real forward when the seeder shadows food_forward', async () => {
            const live = await foodDb().asOwner(async (client) =>
                insertRoot(client, await insertItem(client, null, 'root'), { seedKey: null, userId: null }),
            );

            expect(
                await attempt(
                    'seeder',
                    [
                        ['CREATE TEMPORARY TABLE food_forward AS SELECT $1::text AS source_id', [live]],
                        ['UPDATE food SET retired_at = now() WHERE id = $1', [live]],
                        recordSeed(),
                    ],
                    true,
                ),
            ).toBe('23514');
        });
    });

    describe('every policy table takes its keys without a sequence right', () => {
        /** Columns of the given tables whose default draws from a sequence (serial or nextval), as `table.column`. */
        const sequenceDefaults = (client: pg.ClientBase, tables: readonly string[]): Promise<readonly string[]> =>
            client
                .query<{ column: string }>(
                    `SELECT c.relname || '.' || a.attname AS column
                       FROM pg_catalog.pg_attrdef d
                       JOIN pg_catalog.pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                       JOIN pg_catalog.pg_class c ON c.oid = d.adrelid
                       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
                        AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%'
                      ORDER BY 1`,
                    [tables],
                )
                .then((found) => found.rows.map((row) => row.column));
        const policyTables = (): readonly string[] => [
            ...FOOD_TABLE_POLICY.catalog,
            ...FOOD_TABLE_POLICY.serviceReadOnly,
            ...FOOD_TABLE_POLICY.dictionaries,
        ];

        it('finds no serial column or sequence default on a catalog, ledger or dictionary table', async () => {
            expect(await foodDb().asOwner((client) => sequenceDefaults(client, policyTables()))).toStrictEqual([]);
        });

        it('reports a serial column added to a policy table', async () => {
            const found = await foodDb().asOwner(async (client) => {
                await client.query('BEGIN');

                try {
                    await client.query('ALTER TABLE nutrient ADD COLUMN probe serial');

                    return await sequenceDefaults(client, policyTables());
                } finally {
                    await client.query('ROLLBACK');
                }
            });

            expect(found).toStrictEqual(['nutrient.probe']);
        });
    });

    describe('the enums follow their code lists', () => {
        const enumValues = (name: string): Promise<readonly string[]> =>
            foodDb().asOwner(async (client) => {
                const found = await client.query<{ value: string }>(
                    `SELECT unnest(enum_range(NULL::${name}))::text AS value`,
                );

                return found.rows.map((row) => row.value);
            });

        it('orders the variant attributes as the contract does', async () => {
            expect(await enumValues('food_variant_attribute')).toStrictEqual([...VARIANT_ATTRIBUTES]);
        });

        it('holds every registered source id, in register order', async () => {
            expect(await enumValues('food_source')).toStrictEqual([...REGISTERED_SOURCE_IDS]);
        });

        it('holds every citation dataset and match', async () => {
            expect(await enumValues('citation_dataset')).toStrictEqual([...CITATION_DATASETS]);
            expect(await enumValues('citation_match')).toStrictEqual([...CITATION_MATCHES]);
        });
    });

    describe('the seed ledger', () => {
        const sha = (): string => nextNumber().toString(16).padStart(64, '0');

        it('lets the seeder insert a row without any sequence right, and refuses a malformed digest', async () => {
            expect(
                await attempt('seeder', [['INSERT INTO catalog_seed_ledger (seed_sha) VALUES ($1)', [sha()]]], true),
            ).toBeUndefined();
            expect(await attempt('seeder', [['INSERT INTO catalog_seed_ledger (seed_sha) VALUES ($1)', ['abc']]])).toBe(
                '23514',
            );
        });

        it('refuses UPDATE and DELETE from every role', async () => {
            await foodDb().asOwner((client) =>
                client.query('INSERT INTO catalog_seed_ledger (seed_sha) VALUES ($1)', [sha()]),
            );

            for (const subject of ['app', 'seeder', 'owner'] as const) {
                expect(await attempt(subject, [['UPDATE catalog_seed_ledger SET applied_at = applied_at', []]])).toBe(
                    subject === 'owner' ? '23000' : '42501',
                );
                expect(await attempt(subject, [['DELETE FROM catalog_seed_ledger WHERE id > 0', []]])).toBe(
                    subject === 'owner' ? '23000' : '42501',
                );
            }
        });

        it('records the login that inserted each row', async () => {
            expect(await attempt('seeder', [recordSeed()], true)).toBeUndefined();
            await recordSeedAsOwner();

            const loggedBy = await foodDb().asOwner(async (client) => {
                const rows = await client.query<{ applied_by: string }>(
                    'SELECT applied_by FROM catalog_seed_ledger ORDER BY id',
                );

                return rows.rows.map((row) => row.applied_by);
            });

            expect(loggedBy).toStrictEqual([DATABASE_ROLES.food.seeder, DATABASE_ROLES.food.migrator]);
        });

        it('lets food_app read it and write nothing to it', async () => {
            expect(await attempt('app', [['SELECT seed_sha FROM catalog_seed_ledger', []]])).toBeUndefined();
            expect(await attempt('app', [['INSERT INTO catalog_seed_ledger (seed_sha) VALUES ($1)', [sha()]]])).toBe(
                '42501',
            );
        });
    });

    /**
     * The seed's writes and its ledger row commit together (0021): a deferred constraint trigger on every catalog table,
     * queued only for the seeder, refuses a commit whose newest ledger row this transaction did not insert.
     */
    describe('a seeder commit that changes the catalog records a seed', () => {
        beforeEach(async () => {
            // An earlier seed's row, so "the newest ledger row is not this transaction's" is the case decided, not only
            // "the ledger is empty".
            await recordSeedAsOwner();
        });

        const seedMatrix = [
            ...Object.keys(GUARDED_CASES).flatMap((table) =>
                EVENTS.map((event) => [table, event, (w: SeedWorld) => GUARDED_CASES[table]![event](w)] as const),
            ),
            ...Object.keys(VARIANT_CASES).flatMap((table) =>
                EVENTS.map((event) => [table, event, (w: SeedWorld) => VARIANT_CASES[table]![event](w)] as const),
            ),
            [
                'food_forward',
                'INSERT',
                (w: SeedWorld): Statement => [
                    `INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ($1, 'variant', $2)`,
                    [w.variant, w.root],
                ],
            ] as const,
        ];

        it.each(seedMatrix)('⛔ %s %s: refuses the commit with no seed recorded', async (_table, _event, write) => {
            expect(await attempt('seeder', [write(seed)], true)).toBe('23514');
        });

        it.each(seedMatrix)('%s %s: commits with a seed recorded (positive control)', async (_table, _event, write) => {
            expect(await attempt('seeder', [write(seed), recordSeed()], true)).toBeUndefined();
        });

        it('still refuses when a temporary table shadows the ledger with a row of this transaction', async () => {
            expect(
                await attempt(
                    'seeder',
                    [
                        ['CREATE TEMPORARY TABLE catalog_seed_ledger (id bigint, seed_sha text)', []],
                        ["INSERT INTO pg_temp.catalog_seed_ledger VALUES (9223372036854775807, 'shadow')", []],
                        GUARDED_CASES['food']!.UPDATE(seed),
                    ],
                    true,
                ),
            ).toBe('23514');
        });

        it('leaves food_app’s and the owner’s commits alone (positive control)', async () => {
            expect(await attempt('app', [GUARDED_CASES['food']!.UPDATE(authored)], true)).toBeUndefined();
            expect(await attempt('owner', [GUARDED_CASES['food']!.UPDATE(seed)], true)).toBeUndefined();
        });

        it('queues the check on exactly the catalog tables, deferred, on every event', async () => {
            const triggers = await foodDb().asOwner(async (client) => {
                const found = await client.query<{ table: string; events: string; deferred: boolean }>(
                    `SELECT c.relname AS table,
                            concat_ws(',', CASE WHEN t.tgtype & 4 <> 0 THEN 'INSERT' END,
                                      CASE WHEN t.tgtype & 8 <> 0 THEN 'DELETE' END,
                                      CASE WHEN t.tgtype & 16 <> 0 THEN 'UPDATE' END) AS events,
                            t.tgdeferrable AND t.tginitdeferred AS deferred
                       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                      WHERE t.tgfoid = 'public.catalog_seed_recorded'::regproc ORDER BY 1`,
                );

                return found.rows;
            });

            expect(triggers.map((row) => row.table)).toStrictEqual([...FOOD_TABLE_POLICY.catalog].sort());
            expect(triggers.every((row) => row.events === 'INSERT,DELETE,UPDATE' && row.deferred)).toBe(true);
        });
    });

    describe('the dictionaries', () => {
        it('lets food_app delete no category, and a referenced category never cascades into the catalog', async () => {
            expect(await attempt('app', [['DELETE FROM food_category WHERE id = $1', [seed.category]]])).toBe('42501');
            expect(await attempt('owner', [['DELETE FROM food_category WHERE id = $1', [seed.category]]])).toBe(
                '23503',
            );
        });

        it('lets the seeder and food_app insert an entry and update or delete none', async () => {
            for (const subject of ['app', 'seeder'] as const) {
                expect(
                    await attempt(subject, [
                        ["INSERT INTO nutrient (id, name, unit) VALUES ($1, $1, 'g')", [newId('nutrient')]],
                        ['INSERT INTO food_category (id, name) VALUES ($1, $1)', [newId('category')]],
                    ]),
                ).toBeUndefined();
                expect(
                    await attempt(subject, [["UPDATE nutrient SET unit = 'mg' WHERE id = $1", [seed.nutrient]]]),
                ).toBe('42501');
                expect(await attempt(subject, [['DELETE FROM nutrient WHERE id = $1', [seed.nutrient2]]])).toBe(
                    '42501',
                );
                expect(
                    await attempt(subject, [['UPDATE food_category SET name = name WHERE id = $1', [seed.category]]]),
                ).toBe('42501');
            }
        });

        it('stores an INFOODS tag only in its own spelling', async () => {
            expect(
                await attempt('owner', [
                    [
                        "INSERT INTO nutrient (id, name, unit, infoods_tag) VALUES ($1, $1, 'g', 'procnt')",
                        [newId('nutrient')],
                    ],
                ]),
            ).toBe('23514');
        });
    });

    describe('the catalog registry partitions every table of the schema', () => {
        const readTables = async (client: pg.ClientBase): Promise<{ tables: readonly string[] }> => {
            const tables = await client.query<{ table: string }>(
                "SELECT tablename AS table FROM pg_catalog.pg_tables WHERE schemaname = 'public'",
            );

            return { tables: tables.rows.map((row) => row.table) };
        };

        /** Read the tables inside a transaction that first runs `ddl`, then roll the DDL back. */
        const tablesWith = (ddl: string): Promise<{ tables: readonly string[] }> =>
            foodDb().asOwner(async (client) => {
                await client.query('BEGIN');

                try {
                    await client.query(ddl);

                    return await readTables(client);
                } finally {
                    await client.query('ROLLBACK');
                }
            });

        it('finds nothing wrong with the migrated schema', async () => {
            const schema = await foodDb().asOwner(readTables);

            expect(catalogPartitionProblems({ ...schema, registry: FOOD_CATALOG_REGISTRY })).toStrictEqual([]);
        });

        it.each([
            ['a table that references food_item', 'CREATE TABLE rogue_item (item_id text REFERENCES food_item (id))'],
            [
                'a child of food_nutrition',
                'CREATE TABLE rogue_nutrition (nutrition_id text REFERENCES food_nutrition (id))',
            ],
            ['a child of food', 'CREATE TABLE rogue_food (food_id text REFERENCES food (id))'],
            ['a table with no foreign key at all', 'CREATE TABLE rogue_loose (id text)'],
        ])('reports %s that is not registered', async (_case, ddl) => {
            const table = /CREATE TABLE (\w+)/u.exec(ddl)?.[1];

            expect(
                catalogPartitionProblems({ ...(await tablesWith(ddl)), registry: FOOD_CATALOG_REGISTRY }),
            ).toStrictEqual([{ kind: 'unregistered', table }]);
        });

        it('reports a table in two sets and an entry naming no table', async () => {
            const schema = await foodDb().asOwner(readTables);
            const registry = {
                ...FOOD_CATALOG_REGISTRY,
                dictionaries: new Set([...FOOD_CATALOG_REGISTRY.dictionaries, 'food_portions', 'no_such_table']),
            };

            expect(catalogPartitionProblems({ ...schema, registry })).toStrictEqual([
                { kind: 'inSeveralSets', table: 'food_portions', sets: ['catalog', 'dictionaries'] },
                { kind: 'absent', table: 'no_such_table' },
            ]);
        });
    });

    describe('food_forward', () => {
        /** A live, unauthored catalog food that the seed does not own. */
        const liveFood = (): Promise<string> =>
            foodDb().asOwner(async (client) =>
                insertRoot(client, await insertItem(client, null, 'root'), { seedKey: null, userId: null }),
            );

        const forwardRow = (source: string, targetFood: string | null, targetVariant: string | null): Statement => [
            "INSERT INTO food_forward (source_id, source_kind, target_food_id, target_variant_id) VALUES ($1, 'root', $2, $3)",
            [source, targetFood, targetVariant],
        ];

        const forward = (source: string, target: string, kind = 'root'): Statement => [
            'INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ($1, $2, $3)',
            [source, kind, target],
        ];

        it('lets the seeder forward a row it deleted in the same transaction', async () => {
            expect(
                await attempt(
                    'seeder',
                    [['DELETE FROM food WHERE id = $1', [seed.root2]], forward(seed.root2, seed.root), recordSeed()],
                    true,
                ),
            ).toBeUndefined();
        });

        it('lets the seeder retire a live food that a seed root claims, and forward it', async () => {
            const live = await liveFood();

            expect(
                await attempt(
                    'seeder',
                    [
                        ['UPDATE food SET retired_at = now(), updated_at = now() WHERE id = $1', [live]],
                        forward(live, seed.root),
                        recordSeed(),
                    ],
                    true,
                ),
            ).toBeUndefined();
        });

        it('refuses the seeder any other write to a live food', async () => {
            const live = await liveFood();

            expect(
                await attempt('seeder', [["UPDATE food SET retired_at = now(), name = 'x' WHERE id = $1", [live]]]),
            ).toBe('42501');
        });

        // The exception is judged on the OLD row's item too, so the seeder cannot take a food by moving it onto an item
        // it owns. An authored food also meets the authored-root rule, which refuses first.
        it('refuses the seeder moving a food it does not own onto a seed-owned item', async () => {
            const live = await liveFood();

            expect(
                await attempt('seeder', [['UPDATE food SET item_id = $1 WHERE id = $2', [seed.spareRootItem, live]]]),
            ).toBe('42501');
            expect(
                await attempt('seeder', [
                    [
                        "UPDATE food SET item_id = $1, name = 'renamed by seeder' WHERE id = $2",
                        [seed.spareRootItem, authored.bareRoot],
                    ],
                ]),
            ).toMatch(/^(42501|23514)$/u);
        });

        it('admits the seeder moving a seed root onto another seed-owned item, as a merge does (positive control)', async () => {
            expect(
                await attempt('seeder', [
                    ['UPDATE food SET item_id = $1 WHERE id = $2', [seed.spareRootItem, seed.root]],
                ]),
            ).toBeUndefined();
        });

        it('lets food_app retire a live food and forward it to a live root, inside a nested transaction too', async () => {
            const live = await liveFood();

            expect(
                await attempt(
                    'app',
                    [['UPDATE food SET retired_at = now() WHERE id = $1', [live]], forward(live, seed.root)],
                    true,
                ),
            ).toBeUndefined();

            const nested = await liveFood();

            expect(
                await attempt(
                    'app',
                    [
                        ['SAVEPOINT retire', []],
                        ['UPDATE food SET retired_at = now() WHERE id = $1', [nested]],
                        ['RELEASE SAVEPOINT retire', []],
                        forward(nested, seed.root),
                    ],
                    true,
                ),
            ).toBeUndefined();
        });

        it('refuses a retired live food with no forward at commit', async () => {
            const live = await liveFood();

            expect(await attempt('app', [['UPDATE food SET retired_at = now() WHERE id = $1', [live]]], true)).toBe(
                '23514',
            );
        });

        it('refuses food_app a forward from a seed-owned or an authored source', async () => {
            expect(await attempt('app', [forward(seed.root2, seed.root)])).toBe('42501');
            expect(await attempt('app', [forward(authored.root2, seed.root)])).toBe('42501');
        });

        it('refuses food_app a forward from a source it does not retire', async () => {
            const live = await liveFood();

            expect(await attempt('app', [forward(live, seed.root)])).toBe('42501');
        });

        // The staff-architect review of 2026-10-01: a forward's target carries no foreign key, as its source never did,
        // because the seed may delete a row a cook's live-path forward names (a merge absorbs it) and the seeder may
        // not re-aim that forward. A deferred check proves at commit that every chain still resolves.
        describe('a forward target the seed deletes', () => {
            /** A live food that food_app retired earlier and forwarded to `target`, written as the owner. */
            const livePathForwardTo = async (target: { foodId: string } | { variantId: string }): Promise<string> => {
                const live = await liveFood();

                await foodDb().asOwner(async (client) => {
                    await client.query('BEGIN');
                    await client.query('UPDATE food SET retired_at = now() WHERE id = $1', [live]);
                    await client.query(
                        `INSERT INTO food_forward (source_id, source_kind, target_food_id, target_variant_id)
                         VALUES ($1, 'root', $2, $3)`,
                        [
                            live,
                            'foodId' in target ? target.foodId : null,
                            'variantId' in target ? target.variantId : null,
                        ],
                    );
                    await client.query('COMMIT');
                });

                return live;
            };

            it('lets the seeder delete a root a live-path forward names, when the root gets its own forward', async () => {
                await livePathForwardTo({ foodId: seed.root2 });

                expect(
                    await attempt(
                        'seeder',
                        [
                            ['DELETE FROM food WHERE id = $1', [seed.root2]],
                            forward(seed.root2, seed.root),
                            recordSeed(),
                        ],
                        true,
                    ),
                ).toBeUndefined();
            });

            it('lets the seeder delete and re-insert a variant a live-path forward names, under its own id', async () => {
                await livePathForwardTo({ variantId: seed.variant });

                expect(
                    await attempt(
                        'seeder',
                        [
                            ['DELETE FROM food_variant WHERE id = $1', [seed.variant]],
                            [
                                'INSERT INTO food_variant (id, food_id, item_id) VALUES ($1, $2, $3)',
                                [seed.variant, seed.root, seed.variantItem],
                            ],
                            recordSeed(),
                        ],
                        true,
                    ),
                ).toBeUndefined();
            });

            it('refuses at commit deleting a root a forward names when the root gets no forward of its own', async () => {
                await livePathForwardTo({ foodId: seed.root2 });

                expect(
                    await attempt('seeder', [['DELETE FROM food WHERE id = $1', [seed.root2]], recordSeed()], true),
                ).toBe('23503');
            });

            it.each([
                ['a root id that names no row', (): Statement => forwardRow(seed.root2, newId('food'), null)],
                ['a root id written as a variant target', (): Statement => forwardRow(seed.root2, null, seed.root)],
            ])('refuses a forward whose target is %s', async (_label, row) => {
                expect(await attempt('seeder', [['DELETE FROM food WHERE id = $1', [seed.root2]], row()])).toBe(
                    '42501',
                );
            });
        });

        it('refuses food_app a forward from a food retired in an earlier transaction', async () => {
            const live = await liveFood();

            await foodDb().asOwner(async (client) => {
                await client.query('BEGIN');
                await client.query('UPDATE food SET retired_at = now() WHERE id = $1', [live]);
                await client.query(
                    'INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ($1, $2, $3)',
                    [live, 'root', seed.root],
                );
                await client.query('COMMIT');
                await client.query('DELETE FROM food_forward WHERE source_id = $1', [live]);
            });

            expect(await attempt('app', [forward(live, seed.root)])).toBe('42501');
        });

        it('refuses food_app a forward to a retired target', async () => {
            const live = await liveFood();
            const target = await liveFood();

            await foodDb().asOwner(async (client) => {
                await client.query('BEGIN');
                await client.query('UPDATE food SET retired_at = now() WHERE id = $1', [target]);
                await client.query(
                    'INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ($1, $2, $3)',
                    [target, 'root', seed.root],
                );
                await client.query('COMMIT');
            });

            expect(
                await attempt('app', [
                    ['UPDATE food SET retired_at = now() WHERE id = $1', [live]],
                    forward(live, target),
                ]),
            ).toBe('42501');
        });

        it('refuses food_app any update or delete of a forward', async () => {
            const live = await liveFood();

            expect(
                await attempt(
                    'app',
                    [['UPDATE food SET retired_at = now() WHERE id = $1', [live]], forward(live, seed.root)],
                    true,
                ),
            ).toBeUndefined();

            expect(
                await attempt('app', [
                    ['UPDATE food_forward SET created_at = created_at WHERE source_id = $1', [live]],
                ]),
            ).toBe('42501');
            expect(await attempt('app', [['DELETE FROM food_forward WHERE source_id = $1', [live]]])).toBe('42501');
        });

        // A forward is history: the apply only inserts one (KTD-8), and a retired successor is reached by following the
        // chain, never by rewriting it. So an UPDATE is the owner's alone, and the seeder cannot re-aim one it wrote.
        it('refuses the seeder any update of a forward, and admits the owner (positive control)', async () => {
            const gone = newId('food');
            const live = await liveFood();

            await foodDb().asOwner((client) =>
                client.query(
                    "INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ($1, 'root', $2)",
                    [gone, seed.root],
                ),
            );

            const retarget: Statement = [
                'UPDATE food_forward SET target_food_id = $1 WHERE source_id = $2',
                [live, gone],
            ];
            const updates: readonly Statement[] = [
                retarget,
                ['UPDATE food_forward SET source_id = $1 WHERE source_id = $2', [live, gone]],
                ["UPDATE food_forward SET source_kind = 'variant' WHERE source_id = $1", [gone]],
            ];

            for (const update of updates) {
                expect(await attempt('seeder', [update])).toBe('42501');
            }

            expect(await attempt('owner', [retarget])).toBeUndefined();
        });

        // The apply deletes a forward it will restore or re-aim (U6 phase 3), so the seeder deletes by the same source
        // rule it inserts by: a row it removed or one the seed owns, judged by the table the source is in.
        describe('the seeder deletes only a forward whose source it could have forwarded', () => {
            const ownerForward = (source: string, kind = 'root'): Promise<unknown> =>
                foodDb().asOwner((client) =>
                    client.query(
                        'INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ($1, $2, $3)',
                        [source, kind, seed.root],
                    ),
                );
            const deleteForward = (source: string): Statement => [
                'DELETE FROM food_forward WHERE source_id = $1',
                [source],
            ];

            it('admits it for a removed source and a seed-owned one', async () => {
                const gone = newId('food');

                await ownerForward(gone);
                await ownerForward(seed.root2);

                expect(await attempt('seeder', [deleteForward(gone), deleteForward(seed.root2)])).toBeUndefined();
            });

            it('refuses it for a live food food_app retired and forwarded, and for an authored food', async () => {
                const live = await liveFood();

                expect(
                    await attempt(
                        'app',
                        [['UPDATE food SET retired_at = now() WHERE id = $1', [live]], forward(live, seed.root)],
                        true,
                    ),
                ).toBeUndefined();
                await ownerForward(authored.root2);

                expect(await attempt('seeder', [deleteForward(live)])).toBe('42501');
                expect(await attempt('seeder', [deleteForward(authored.root2)])).toBe('42501');
            });

            it('judges the source by its table, whatever kind the row claims', async () => {
                const live = await liveFood();

                await ownerForward(live, 'variant');

                expect(await attempt('seeder', [deleteForward(live)])).toBe('42501');
            });
        });

        it('refuses a forward whose kind names the other table, and admits it with the right kind', async () => {
            const live = await liveFood();

            expect(await attempt('seeder', [forward(live, seed.root, 'variant')])).toBe('42501');
            expect(await attempt('seeder', [forward(seed.variant, seed.root, 'root')])).toBe('42501');
            expect(await attempt('seeder', [forward(seed.variant, seed.root, 'variant')])).toBeUndefined();
        });

        it('refuses a forward with no target or two', async () => {
            expect(
                await attempt('owner', [
                    ["INSERT INTO food_forward (source_id, source_kind) VALUES ($1, 'root')", [newId('food')]],
                ]),
            ).toBe('23514');
            expect(
                await attempt('owner', [
                    [
                        "INSERT INTO food_forward (source_id, source_kind, target_food_id, target_variant_id) VALUES ($1, 'root', $2, $3)",
                        [newId('food'), seed.root, seed.variant],
                    ],
                ]),
            ).toBe('23514');
        });
    });

    // KTD-12's key claim (owner, 2026-10-01): the seed takes over a live food that holds a source key it wants. The
    // guard admits the SHAPE at each statement (the holder is unauthored and retired; a deleted child cites a source
    // row), and a deferred trigger proves the obligation at commit (a seed-owned row holds the released key; no
    // child outlives its source row), as `food_retire_forwarded` proves the forward.
    describe('the key claim', () => {
        interface KeyedLiveFood {
            readonly food: string;
            readonly item: string;
            readonly source: string;
            readonly key: string;
            /** A second source row of the item that nothing cites, so deleting it meets no foreign key. */
            readonly bareSource: string;
            readonly nutrition: string;
        }

        /**
         * A live, unauthored catalog food whose item holds two USDA source rows, three rows citing the first, and a
         * nutrition header.
         */
        const keyedLiveFood = (): Promise<KeyedLiveFood> =>
            foodDb().asOwner(async (client) => {
                const item = await insertItem(client, null, 'root');
                const food = await insertRoot(client, item, { seedKey: null, userId: null });
                const source = newId('source');
                const bareSource = newId('source');
                const key = String(nextNumber());
                const category = newId('category');

                await client.query(
                    "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, 'usda', $3), ($4, $2, 'usda', $5)",
                    [source, item, key, bareSource, String(nextNumber())],
                );
                await client.query(
                    "INSERT INTO food_field_provenance (item_id, field, source_id) VALUES ($1, 'name', $2)",
                    [item, source],
                );
                await client.query('INSERT INTO food_category (id, name) VALUES ($1, $1)', [category]);
                await client.query(
                    'INSERT INTO food_category_assignment (item_id, category_id, source_id) VALUES ($1, $2, $3)',
                    [item, category, source],
                );
                await client.query(
                    'INSERT INTO food_portions (id, item_id, label, gram_weight, source_id) VALUES ($1, $2, $3, 240, $4)',
                    [newId('portion'), item, 'cup', source],
                );

                return { food, item, source, key, bareSource, nutrition: await insertHeader(client, { foodId: food }) };
            });

        const retire = (live: KeyedLiveFood): Statement => [
            'UPDATE food SET retired_at = now(), updated_at = now() WHERE id = $1',
            [live.food],
        ];

        /** The rows citing the holder's source row, then the row itself. */
        const release = (live: KeyedLiveFood): Statement[] => [
            ['DELETE FROM food_field_provenance WHERE item_id = $1 AND source_id = $2', [live.item, live.source]],
            ['DELETE FROM food_category_assignment WHERE item_id = $1 AND source_id = $2', [live.item, live.source]],
            ['DELETE FROM food_portions WHERE item_id = $1 AND source_id = $2', [live.item, live.source]],
            ['DELETE FROM food_sources WHERE id = $1', [live.source]],
        ];

        /** The seed's own item, root and source row for the released key; the root's id is `entry`. */
        const seedTakes = (live: KeyedLiveFood, entry: string): Statement[] => {
            const item = newId('item');

            return [
                [
                    "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ($1, $2, 'root')",
                    [item, `fdc:${live.key}`],
                ],
                [
                    `INSERT INTO food (id, item_id, name, normalized_name, seed_key, visibility)
                     VALUES ($1, $2, $3, $3, $4, 'public')`,
                    [entry, item, `taken ${live.key}`, `fdc:${live.key}`],
                ],
                [
                    "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, 'usda', $3)",
                    [newId('source'), item, live.key],
                ],
            ];
        };

        const forwardTo = (live: KeyedLiveFood, entry: string): Statement => [
            "INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ($1, 'root', $2)",
            [live.food, entry],
        ];

        it('lets the seeder take over a live food’s key: retire it, release its row, write its own, forward it', async () => {
            const live = await keyedLiveFood();
            const entry = newId('food');

            expect(
                await attempt(
                    'seeder',
                    [retire(live), ...release(live), ...seedTakes(live, entry), forwardTo(live, entry), recordSeed()],
                    true,
                ),
            ).toBeUndefined();
        });

        it('lets the seeder release the key of a food retired earlier, keeping its forward', async () => {
            const live = await keyedLiveFood();

            await foodDb().asOwner(async (client) => {
                await client.query('BEGIN');
                await client.query('UPDATE food SET retired_at = now() WHERE id = $1', [live.food]);
                await client.query(
                    "INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ($1, 'root', $2)",
                    [live.food, seed.root],
                );
                await client.query('COMMIT');
            });

            expect(
                await attempt('seeder', [...release(live), ...seedTakes(live, newId('food')), recordSeed()], true),
            ).toBeUndefined();
        });

        it.each<[string, (live: KeyedLiveFood) => Statement[]]>([
            [
                'the source row of a live food it has not retired',
                (live) => [['DELETE FROM food_sources WHERE id = $1', [live.bareSource]]],
            ],
            ['a child row of a live food it has not retired', (live) => [release(live)[0]!]],
            [
                'the source row of an authored food',
                () => [['DELETE FROM food_sources WHERE id = $1', [authored.source2]]],
            ],
            [
                'a category row that cites no source row',
                (live) => [
                    retire(live),
                    ['UPDATE food_category_assignment SET source_id = NULL WHERE item_id = $1', [live.item]],
                ],
            ],
            [
                'the nutrition of the food it retired',
                (live) => [retire(live), ['DELETE FROM food_nutrition WHERE id = $1', [live.nutrition]]],
            ],
            [
                'a source row it re-points instead of releasing',
                (live) => [
                    retire(live),
                    ["UPDATE food_sources SET external_key = 'elsewhere' WHERE id = $1", [live.source]],
                ],
            ],
        ])('refuses the seeder %s', async (_label, statements) => {
            const live = await keyedLiveFood();

            expect(await attempt('seeder', statements(live))).toBe('42501');
        });

        it('refuses at commit a released key no seed-owned row takes', async () => {
            const live = await keyedLiveFood();

            expect(
                await attempt(
                    'seeder',
                    [retire(live), ...release(live), forwardTo(live, seed.root), recordSeed()],
                    true,
                ),
            ).toBe('23514');
        });

        it('refuses at commit a child row released while its source row stays', async () => {
            const live = await keyedLiveFood();

            expect(
                await attempt(
                    'seeder',
                    [retire(live), release(live)[0]!, forwardTo(live, seed.root), recordSeed()],
                    true,
                ),
            ).toBe('23514');
        });
    });

    describe('nutrition', () => {
        it('refuses a header with no owner or two, and a second header for one owner', async () => {
            expect(await attempt('owner', [['INSERT INTO food_nutrition (id) VALUES ($1)', [newId('n')]]])).toBe(
                '23514',
            );
            expect(
                await attempt('owner', [
                    [
                        'INSERT INTO food_nutrition (id, food_id, food_variant_id) VALUES ($1, $2, $3)',
                        [newId('n'), seed.root, seed.variant],
                    ],
                ]),
            ).toBe('23514');
            expect(
                await attempt('owner', [
                    ['INSERT INTO food_nutrition (id, food_id) VALUES ($1, $2)', [newId('n'), seed.root]],
                ]),
            ).toBe('23505');
            expect(
                await attempt('owner', [
                    ['INSERT INTO food_nutrition (id, food_variant_id) VALUES ($1, $2)', [newId('n'), seed.variant]],
                    ['INSERT INTO food_nutrition (id, food_variant_id) VALUES ($1, $2)', [newId('n'), seed.variant]],
                ]),
            ).toBe('23505');
        });

        it('refuses changing either arm', async () => {
            expect(
                await attempt('owner', [
                    ['UPDATE food_nutrition SET food_id = $2 WHERE id = $1', [seed.nutrition, seed.root2]],
                ]),
            ).toBe('23000');
            expect(
                await attempt('owner', [
                    [
                        'UPDATE food_nutrition SET food_id = NULL, food_variant_id = $2 WHERE id = $1',
                        [seed.nutrition, seed.variant],
                    ],
                ]),
            ).toBe('23000');
        });

        it('removes the header, its values and its citations with its owner', async () => {
            const counts = await foodDb().asOwner(async (client) => {
                await client.query('DELETE FROM food WHERE id = $1', [seed.root2]);
                const left = await client.query<{ headers: number; values: number; citations: number }>(
                    `SELECT (SELECT count(*) FROM food_nutrition WHERE food_id = $1)::int AS headers,
                            (SELECT count(*) FROM food_nutrition_value v LEFT JOIN food_nutrition h ON h.id = v.nutrition_id
                              WHERE h.id IS NULL)::int AS values,
                            (SELECT count(*) FROM food_nutrition_citation c LEFT JOIN food_nutrition h ON h.id = c.nutrition_id
                              WHERE h.id IS NULL)::int AS citations`,
                    [seed.root2],
                );

                return left.rows[0];
            });

            expect(counts).toStrictEqual({ headers: 0, values: 0, citations: 0 });
        });

        it("refuses a value that cites another header's citation", async () => {
            const other = await foodDb().asOwner(async (client) => {
                const header = await insertHeader(client, { variantId: seed.variant });

                return insertCitation(client, header);
            });

            expect(
                await attempt('owner', [
                    [
                        "INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id) VALUES ($1, $2, 1, 'per_100g', $3)",
                        [seed.nutrition, seed.nutrient2, other],
                    ],
                ]),
            ).toBe('23503');
        });

        it.each([
            [
                'an external key and a URL',
                "'usdaBranded', '123', 'exact', 'https://example.test', NULL, NULL, NULL, NULL",
            ],
            ['neither an external key nor a URL', "'usdaBranded', NULL, NULL, NULL, NULL, NULL, NULL, NULL"],
            [
                'a label with NULL serving grams',
                "'label', NULL, NULL, 'https://example.test', '2026-09-30', 'Maker', '1 bar', NULL",
            ],
            [
                'a label with an external key',
                "'label', '123', NULL, 'https://example.test', '2026-09-30', 'Maker', '1 bar', 40",
            ],
        ])('refuses a citation with %s', async (_case, values) => {
            expect(
                await attempt('owner', [
                    [
                        `INSERT INTO food_nutrition_citation
                           (id, nutrition_id, dataset, external_key, match, url, retrieved_on, manufacturer, serving_label, serving_grams)
                         VALUES ($1, $2, ${values})`,
                        [newId('citation'), seed.nutrition],
                    ],
                ]),
            ).toBe('23514');
        });

        it('stores a trace mark as a mark, never as a value', async () => {
            const insert = (amount: number | null, trace: boolean): Statement => [
                `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, trace, basis, citation_id)
                 VALUES ($1, $2, $3, $4, 'per_100g', $5)`,
                [seed.nutrition, seed.nutrient2, amount, trace, seed.citation],
            ];

            expect(await attempt('owner', [insert(null, true)])).toBeUndefined();
            expect(await attempt('owner', [insert(0, true)])).toBe('23514');
            expect(await attempt('owner', [insert(null, false)])).toBe('23514');
        });

        describe('an uncited value or portion means the food was authored', () => {
            const uncitedValue = (nutritionId: string, nutrientId: string): Statement => [
                "INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis) VALUES ($1, $2, 4, 'per_100g')",
                [nutritionId, nutrientId],
            ];
            const uncitedPortion = (itemId: string): Statement => [
                "INSERT INTO food_portions (id, item_id, label, gram_weight) VALUES ($1, $2, 'piece', 12)",
                [newId('portion'), itemId],
            ];

            it('admits it under an authored food', async () => {
                expect(await attempt('app', [uncitedValue(authored.nutrition, authored.nutrient2)])).toBeUndefined();
                expect(await attempt('app', [uncitedPortion(authored.item)])).toBeUndefined();
            });

            it('refuses it under a live food, a seeded root and a variant, and admits a cited one in each', async () => {
                const live = await foodDb().asOwner(async (client) => {
                    const itemId = await insertItem(client, null, 'root');
                    const foodId = await insertRoot(client, itemId, { seedKey: null, userId: null });
                    const header = await insertHeader(client, { foodId });

                    return { itemId, header, citation: await insertCitation(client, header) };
                });
                const variant = await foodDb().asOwner(async (client) => {
                    const header = await insertHeader(client, { variantId: seed.variant });

                    return { header, citation: await insertCitation(client, header) };
                });
                const cases = [
                    { subject: 'app' as const, header: live.header, citation: live.citation },
                    { subject: 'owner' as const, header: seed.nutrition, citation: seed.citation },
                    { subject: 'owner' as const, header: variant.header, citation: variant.citation },
                ];

                for (const { subject, header, citation } of cases) {
                    expect(await attempt(subject, [uncitedValue(header, seed.nutrient2)])).toBe('23000');
                    expect(
                        await attempt(subject, [
                            [
                                "INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id) VALUES ($1, $2, 4, 'per_100g', $3)",
                                [header, seed.nutrient2, citation],
                            ],
                        ]),
                    ).toBeUndefined();
                }

                expect(await attempt('app', [uncitedPortion(live.itemId)])).toBe('23000');
                expect(await attempt('owner', [uncitedPortion(seed.item)])).toBe('23000');
                expect(await attempt('owner', [uncitedPortion(seed.variantItem)])).toBe('23000');
            });

            it('refuses a portion with both a source row and a citation', async () => {
                expect(
                    await attempt('owner', [
                        [
                            "INSERT INTO food_portions (id, item_id, label, gram_weight, source_id, citation_id) VALUES ($1, $2, 'bar', 40, $3, $4)",
                            [newId('portion'), seed.item, seed.source, seed.citation],
                        ],
                    ]),
                ).toBe('23514');
            });
        });

        it('admits a seeder merge-delete that cascades into nutrition', async () => {
            expect(
                await attempt('seeder', [['DELETE FROM food WHERE id = $1', [seed.root2]], recordSeed()], true),
            ).toBeUndefined();
        });

        it('admits an authored erasure by food_app that cascades', async () => {
            expect(
                await attempt(
                    'app',
                    [
                        [
                            `WITH gone AS (DELETE FROM food WHERE user_id = $1 AND id = $2 RETURNING item_id)
                             DELETE FROM food_item WHERE id IN (SELECT item_id FROM gone)`,
                            [WORLD_AUTHOR, authored.root2],
                        ],
                    ],
                    true,
                ),
            ).toBeUndefined();
        });

        it("refuses food_app deleting a seeded root, and the root's nutrition survives", async () => {
            expect(await attempt('app', [['DELETE FROM food WHERE id = $1', [seed.root2]]])).toBe('42501');

            const headers = await foodDb().asOwner(async (client) => {
                const found = await client.query<{ n: number }>(
                    'SELECT count(*)::int AS n FROM food_nutrition WHERE food_id = $1',
                    [seed.root2],
                );

                return found.rows[0]?.n;
            });

            expect(headers).toBe(1);
        });

        it('keeps a root with no USDA item on a sourceless item, with no nutrition or with a label', async () => {
            const result = await attempt(
                'seeder',
                [
                    [
                        "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('item-nolabel', 'curated:no-numbers', 'root')",
                        [],
                    ],
                    [
                        "INSERT INTO food (id, item_id, name, normalized_name, seed_key) VALUES ('food-nolabel', 'item-nolabel', 'no numbers', 'no numbers', 'curated:no-numbers')",
                        [],
                    ],
                    [
                        "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('item-label', 'curated:label-only', 'root')",
                        [],
                    ],
                    [
                        "INSERT INTO food (id, item_id, name, normalized_name, seed_key) VALUES ('food-label', 'item-label', 'label only', 'label only', 'curated:label-only')",
                        [],
                    ],
                    ["INSERT INTO food_nutrition (id, food_id) VALUES ('nutrition-label', 'food-label')", []],
                    [
                        `INSERT INTO food_nutrition_citation
                           (id, nutrition_id, dataset, url, retrieved_on, manufacturer, serving_label, serving_grams)
                         VALUES ('citation-label', 'nutrition-label', 'label', 'https://example.test/bar', '2026-09-30', 'Maker', '1 bar', 40)`,
                        [],
                    ],
                    [
                        "INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id) VALUES ('nutrition-label', $1, 250, 'per_100g', 'citation-label')",
                        [seed.nutrient],
                    ],
                    [
                        "INSERT INTO food_portions (id, item_id, label, gram_weight, citation_id) VALUES ('portion-label', 'item-label', '1 bar', 40, 'citation-label')",
                        [],
                    ],
                    recordSeed(),
                ],
                true,
            );

            expect(result).toBeUndefined();
        });

        it('infers each arm’s partial unique index under ON CONFLICT', async () => {
            const header = await foodDb().asOwner(async (client) => {
                const byRoot = await client.query<{ id: string }>(
                    `INSERT INTO food_nutrition (id, food_id) VALUES ($1, $2)
                     ON CONFLICT (food_id) WHERE food_id IS NOT NULL DO UPDATE SET food_id = EXCLUDED.food_id RETURNING id`,
                    [newId('n'), seed.root],
                );
                const byVariant = await client.query<{ id: string }>(
                    `INSERT INTO food_nutrition (id, food_variant_id) VALUES ($1, $2)
                     ON CONFLICT (food_variant_id) WHERE food_variant_id IS NOT NULL DO NOTHING RETURNING id`,
                    [newId('n'), seed.variant],
                );
                const again = await client.query<{ id: string }>(
                    `INSERT INTO food_nutrition (id, food_variant_id) VALUES ($1, $2)
                     ON CONFLICT (food_variant_id) WHERE food_variant_id IS NOT NULL DO NOTHING RETURNING id`,
                    [newId('n'), seed.variant],
                );

                return { root: byRoot.rows[0]?.id, variant: byVariant.rowCount, again: again.rowCount };
            });

            expect(header).toStrictEqual({ root: seed.nutrition, variant: 1, again: 0 });
        });
    });

    describe('the nutrient view', () => {
        it('reads both arms, with each value’s definition and dataset', async () => {
            const rows = await foodDb().asOwner(async (client) => {
                const header = await insertHeader(client, { variantId: seed.variant });
                const citation = await insertCitation(client, header);
                const nutrient = await insertNutrient(client);

                await client.query(
                    "INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id) VALUES ($1, $2, 7, 'per_100g', $3)",
                    [header, nutrient, citation],
                );

                const found = await client.query(
                    `SELECT food_id, food_variant_id, amount::text AS amount, trace, dataset FROM food_nutrient_view
                      WHERE food_id = $1 OR food_variant_id = $2 ORDER BY food_id NULLS FIRST`,
                    [seed.root, seed.variant],
                );

                return found.rows;
            });

            expect(rows).toStrictEqual([
                {
                    food_id: null,
                    food_variant_id: seed.variant,
                    amount: '7',
                    trace: false,
                    dataset: 'usdaSrFoundation',
                },
                { food_id: seed.root, food_variant_id: null, amount: '10', trace: false, dataset: 'usdaSrFoundation' },
            ]);
        });
    });
});
