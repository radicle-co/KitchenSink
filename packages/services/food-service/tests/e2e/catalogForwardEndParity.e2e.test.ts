/**
 * ⛔ Where a forward chain may end, as the verifier reads it, equals where the reader ends it (curated catalog plan U6,
 * U8; KTD-3; ADR-0050 §4).
 *
 * LOCAL target. The verifier's fence (`eslint.config.js`, KTD-3) keeps it from importing the reader, so the rule is
 * written twice: in `checkForwards.sql`, and in `FoodForwardDao.follow` with `refTargetOf` and `answeringEntryOf`. This
 * suite runs both over the same rows, one chain per case, and compares them forward by forward: the sources whose chain
 * the reader does not answer for must be exactly the sources `checkForwards.sql` fails, read from the verifier's own
 * directory and run on a prepared seeder session. Each case pins its head's verdict too, so the two cannot move
 * together unnoticed.
 *
 * Three ends are left out because no service writer can produce them: a retired authored root (the schema's
 * `food_retired_not_authored`), a live authored root (`food_forward_guard` refuses a forward to one) and a catalog root
 * mid-erasure (`foods.service.ts`: only an authored row is ever tombstoned).
 */
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CatalogOwnerReader } from '../../src/foods/catalogOwnerReader.service.js';
import { MAX_FORWARD_HOPS } from '../../src/foods/dao/foodForward.dao.js';
import { answeringEntryOf, refTargetOf } from '../../src/foods/domain/foodRefResolution.js';
import type { FoodRef } from '../../src/foods/foods.schema.js';
import { prepareCatalogVerifier } from '../../src/foods/seed/verify/catalogVerifier.js';
import { readVerifierSql } from '../../src/foods/seed/verify/verifierSql.js';
import { makeSeededRoot, type SeededRoot, type SeededVariantSpec } from '../__fixtures__/catalogFood.js';
import { makeDb } from '../support/db.js';
import { makeCatalogOwnerReader } from '../support/ownerReader.js';
import { foodDb } from '../support/roleDb.js';

const DATA_DIR = join(import.meta.dirname, '../../src/foods/seed/data');
const SQL_DIR = join(import.meta.dirname, '../../src/foods/seed/verify/sql');
const FORWARDS_SQL = 'checkForwards.sql';

const UNRESOLVED = 'food_forward: a forward does not end at a catalog root or variant within 8 forwards';

const FLAT: SeededVariantSpec = { parts: [{ attribute: 'cut', text: 'flat' }] };

/** A forward's source or target, by kind. */
type Entry = { readonly kind: 'root' | 'variant'; readonly id: string };

/**
 * Forward a retired row to a target, as the owner, past `food_forward_guard`.
 *
 * @param source - The forwarded row.
 * @param target - Where it forwards.
 * @sideEffect Inserts one `food_forward` row.
 */
async function forward(source: Entry, target: Entry): Promise<void> {
    await foodDb().asOwner((client) =>
        client.query(
            `INSERT INTO food_forward (source_id, source_kind, target_food_id, target_variant_id)
             VALUES ($1, $2, $3, $4)`,
            [
                source.id,
                source.kind,
                target.kind === 'root' ? target.id : null,
                target.kind === 'variant' ? target.id : null,
            ],
        ),
    );
}

/**
 * One seed-owned root.
 *
 * @param name - Its name; unique within a case.
 * @param retired - Whether the seed retired it.
 * @param variants - Its variants.
 * @returns Its ids.
 * @sideEffect Writes the root as the owner.
 */
async function seeded(
    name: string,
    retired: boolean,
    variants: readonly SeededVariantSpec[] = [],
): Promise<SeededRoot> {
    return makeSeededRoot(foodDb(), { name, retired, variants });
}

/**
 * A retired head whose chain is `forwards` forwards long, through retired roots, to a live root.
 *
 * @param forwards - The chain's length.
 * @returns The head's id.
 * @sideEffect Writes the roots and forwards.
 */
async function chainOf(forwards: number): Promise<string> {
    const end = await seeded('parity end', false);
    const hops = await Promise.all(
        Array.from({ length: forwards }, async (_unused, hop) => seeded(`parity hop ${String(hop)}`, true)),
    );

    for (const [hop, row] of hops.entries()) {
        await forward({ kind: 'root', id: row.id }, { kind: 'root', id: hops[hop + 1]?.id ?? end.id });
    }

    return hops[0]?.id ?? end.id;
}

/**
 * A retired head forwarded to one target.
 *
 * @param target - The target.
 * @returns The head's id.
 * @sideEffect Writes the head and its forward.
 */
async function headTo(target: Entry): Promise<string> {
    const head = await seeded('parity head', true);

    await forward({ kind: 'root', id: head.id }, target);

    return head.id;
}

/** One chain shape, and whether its head answers. */
interface ChainCase {
    readonly name: string;
    /** Writes the chain and returns its head: a retired catalog root with a forward. */
    readonly build: () => Promise<string>;
    readonly answers: boolean;
}

const CASES: readonly ChainCase[] = [
    {
        name: 'a live catalog root',
        build: async () => headTo({ kind: 'root', id: (await seeded('parity live', false)).id }),
        answers: true,
    },
    {
        name: 'a live variant',
        build: async () =>
            headTo({ kind: 'variant', id: (await seeded('parity live', false, [FLAT])).variants[0]!.id }),
        answers: true,
    },
    {
        name: 'a catalog root the seed retired with no successor',
        build: async () => headTo({ kind: 'root', id: (await seeded('parity retired', true)).id }),
        answers: true,
    },
    {
        name: 'a variant the seed retired with no successor',
        build: async () =>
            headTo({
                kind: 'variant',
                id: (await seeded('parity live', false, [{ ...FLAT, retired: true }])).variants[0]!.id,
            }),
        answers: true,
    },
    {
        name: 'a live variant whose root the seed retired',
        build: async () =>
            headTo({ kind: 'variant', id: (await seeded('parity retired', true, [FLAT])).variants[0]!.id }),
        answers: true,
    },
    {
        name: `exactly MAX_FORWARD_HOPS (${String(MAX_FORWARD_HOPS)}) forwards`,
        build: async () => chainOf(MAX_FORWARD_HOPS),
        answers: true,
    },
    { name: 'one forward past MAX_FORWARD_HOPS', build: async () => chainOf(MAX_FORWARD_HOPS + 1), answers: false },
    {
        name: 'a cycle',
        build: async () => {
            const head = await seeded('parity head', true);
            const back = await seeded('parity back', true);

            await forward({ kind: 'root', id: head.id }, { kind: 'root', id: back.id });
            await forward({ kind: 'root', id: back.id }, { kind: 'root', id: head.id });

            return head.id;
        },
        answers: false,
    },
    { name: 'a root that is gone', build: async () => headTo({ kind: 'root', id: 'parity-gone' }), answers: false },
    {
        name: 'a retired catalog root whose own forward leads to a row that is gone',
        build: async () => {
            const onward = await seeded('parity onward', true);

            await forward({ kind: 'root', id: onward.id }, { kind: 'variant', id: 'parity-gone' });

            return headTo({ kind: 'root', id: onward.id });
        },
        answers: false,
    },
    {
        name: 'a retired variant whose own forward leads to a row that is gone',
        build: async () => {
            const onward = (await seeded('parity live', false, [{ ...FLAT, retired: true }])).variants[0]!;

            await forward({ kind: 'variant', id: onward.id }, { kind: 'root', id: 'parity-gone' });

            return headTo({ kind: 'variant', id: onward.id });
        },
        answers: false,
    },
];

describe('checkForwards.sql bounds a chain by MAX_FORWARD_HOPS, the bound the reader follows', () => {
    it(`states ${String(MAX_FORWARD_HOPS)} at every bound it writes`, async () => {
        const [sql = ''] = await readVerifierSql(SQL_DIR, [FORWARDS_SQL]);
        const bounds = [...sql.matchAll(/\bhops <= (\d+)|within (\d+) forwards/gu)].map((match) =>
            Number(match[1] ?? match[2]),
        );

        expect(bounds.length).toBeGreaterThanOrEqual(3);
        expect(new Set(bounds)).toEqual(new Set([MAX_FORWARD_HOPS]));
    });
});

describe('a forward chain ends where the reader ends it, and nowhere else', () => {
    let checker: pg.Client;
    let pool: pg.Pool;
    let reader: CatalogOwnerReader;
    let checkForwards: string;

    /**
     * Whether the reader answers for a ref.
     *
     * @param ref - A root or variant.
     * @returns `true` when its chain ends at an entry that answers.
     * @sideEffect Reads the catalog as `food_app`.
     */
    async function readerAnswers(ref: FoodRef): Promise<boolean> {
        const facts = await reader.refFacts([ref]);
        const target = refTargetOf(ref, facts);

        return target !== undefined && answeringEntryOf(target, facts) !== undefined;
    }

    /**
     * The forward sources whose chain the reader does not answer for.
     *
     * @returns The sources, sorted.
     * @sideEffect Reads the catalog as the seeder and as `food_app`.
     */
    async function readerFailures(): Promise<string[]> {
        const sources = await checker.query<FoodRef>(
            'SELECT source_kind AS kind, source_id AS id FROM public.food_forward',
        );
        const failing: string[] = [];

        for (const source of sources.rows) {
            if (!(await readerAnswers(source))) {
                failing.push(source.id);
            }
        }

        return failing.sort();
    }

    /**
     * What `checkForwards.sql` fails: each fact, the sources it names, and whether its sample names them all.
     *
     * @returns One entry per failing fact.
     * @sideEffect Reads the catalog on the prepared seeder session.
     */
    async function verifierFailures(): Promise<{ fact: string; sources: string[]; complete: boolean }[]> {
        const result = await checker.query<{ table_name: string; fact: string; row_count: string; sample: string[] }>(
            checkForwards,
        );

        return result.rows.map((row) => ({
            fact: `${row.table_name}: ${row.fact}`,
            sources: [...row.sample].sort(),
            complete: Number(row.row_count) === row.sample.length,
        }));
    }

    beforeAll(async () => {
        await foodDb().truncate();
        [checkForwards = ''] = await readVerifierSql(SQL_DIR, [FORWARDS_SQL]);
        checker = new pg.Client({ connectionString: foodDb().seederUrl });
        await checker.connect();
        await prepareCatalogVerifier(checker, { dataDir: DATA_DIR, sqlDir: SQL_DIR });
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        reader = makeCatalogOwnerReader(makeDb(pool));
    }, 300_000);

    beforeEach(async () => {
        await foodDb().truncate();
    });

    afterAll(async () => {
        await checker?.end();
        await pool?.end();
        await foodDb().truncate();
    });

    it.each(CASES.map((chain) => [chain.name, chain] as const))(
        'a forward chain ending at %s',
        async (_name, chain) => {
            const head = await chain.build();
            const failing = await readerFailures();

            expect(failing.includes(head)).toBe(!chain.answers);
            expect(await verifierFailures()).toEqual(
                failing.length === 0 ? [] : [{ fact: UNRESOLVED, sources: failing, complete: true }],
            );
        },
    );
});
