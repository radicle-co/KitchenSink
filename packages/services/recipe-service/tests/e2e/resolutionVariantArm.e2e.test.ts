/**
 * Migration 0052 — the resolution memory names a root OR a variant, exactly one, asserted against a real migrated
 * PostgreSQL (curated plan U9; R20, R23; LOCAL e2e under the 2026-09-20 ruling).
 *
 * `ingredient_resolution_mappings`, `ingredient_resolution_memos` and `recipe_ingredient_verifications` each gain a
 * `food_variant_id` beside `food_id` under `num_nonnulls(food_id, food_variant_id) = 1`, so a correction, a memo and
 * a verdict can each be about a variant. A unit test cannot observe a migration that did not apply, so every claim
 * here is the server's own answer.
 *
 * ## ⛔ Every refusal has a positive control
 *
 * A refusal passes against a table that refuses every row. Each table admits each single arm beside the zero-arm and
 * two-arm rows it refuses.
 *
 * The repository half (P3b) reads and writes the arc through `foodRefArc` against the same migrated tables: the
 * curated and memo reads return a variant, and corroboration compares the arc on BOTH columns, so a root and a
 * variant sharing an id string never corroborate each other.
 *
 * Every row this file writes carries {@link SCOPE} and is removed in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

import { createRecipeDrizzle } from '../../src/database/client.js';
import type { FoodRef } from '../../src/database/schema/foodLookupArm.js';
import { evaluateMappingWrite } from '../../src/ingredients/domain/mappingScopePolicy.js';
import { ResolutionMappingsDal } from '../../src/ingredients/resolution/resolutionMappings.dal.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

/** The prefix every row this file writes carries. */
const SCOPE = 'e2e-variant-arm';

/** SQLSTATE `check_violation`. */
const CHECK_VIOLATION = '23514';

let pool: pg.Pool;
let sequence = 0;

/**
 * Run a statement expected to be REFUSED and report the server's verdict, or a sentinel when it succeeded.
 *
 * @sideEffect Executes SQL against the e2e database.
 */
async function sqlStateOf(text: string, values: readonly unknown[]): Promise<string> {
    try {
        await pool.query(text, [...values]);
    } catch (error) {
        return (error as { code?: string }).code ?? '(threw with no SQLSTATE)';
    }

    return '(statement succeeded)';
}

/** A fresh scoped key, so the cases never collide on a table's own unique keys. */
function nextKey(label: string): string {
    sequence += 1;

    return `${SCOPE}-${label}-${String(sequence)}`;
}

/** One table's insert, given which arm columns to fill: `[food_id, food_variant_id]`. */
interface ArmTable {
    readonly table: string;
    readonly insert: (arms: readonly [string | null, string | null]) => { text: string; values: unknown[] };
}

const TABLES: readonly ArmTable[] = [
    {
        table: 'ingredient_resolution_mappings',
        insert: ([foodId, variantId]) => ({
            text: `INSERT INTO ingredient_resolution_mappings
                       (normalized_key, source_phrase, food_id, food_variant_id, scope, origin, user_id, surfacing)
                   VALUES ($1, $1, $2, $3, 'author', 'author', $4, 'ingredient_picker')`,
            values: [nextKey('mapping'), foodId, variantId, nextKey('user')],
        }),
    },
    {
        table: 'ingredient_resolution_memos',
        insert: ([foodId, variantId]) => ({
            text: `INSERT INTO ingredient_resolution_memos (normalized_key, source_phrase, food_id, food_variant_id, verified_by)
                   VALUES ($1, $1, $2, $3, 'e2e-model')`,
            values: [nextKey('memo'), foodId, variantId],
        }),
    },
    {
        table: 'recipe_ingredient_verifications',
        insert: ([foodId, variantId]) => ({
            text: `INSERT INTO recipe_ingredient_verifications
                       (verification_key, verdict, certainty, band, aspects, model_id, food_id, food_variant_id)
                   VALUES ($1, 'agree', 'high', 'verified', ARRAY['identity'], 'e2e-model', $2, $3)`,
            values: [nextKey('verdict'), foodId, variantId],
        }),
    },
];

describe('the resolution memory’s food arm (0052, curated U9)', () => {
    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 4 });
    });

    afterAll(async () => {
        if (pool === undefined) {
            return;
        }

        await pool.query('DELETE FROM ingredient_resolution_mappings WHERE normalized_key LIKE $1', [`${SCOPE}%`]);
        await pool.query('DELETE FROM ingredient_resolution_memos WHERE normalized_key LIKE $1', [`${SCOPE}%`]);
        await pool.query('DELETE FROM recipe_ingredient_verifications WHERE verification_key LIKE $1', [`${SCOPE}%`]);
        await pool.end();
    });

    describe.each(TABLES)('$table names exactly one food', ({ insert }) => {
        it('⛔ refuses a row with NO food', async () => {
            const { text, values } = insert([null, null]);

            expect(await sqlStateOf(text, values)).toBe(CHECK_VIOLATION);
        });

        it('⛔ refuses a row naming BOTH a root and a variant', async () => {
            const { text, values } = insert([`${SCOPE}-root`, `${SCOPE}-variant`]);

            expect(await sqlStateOf(text, values)).toBe(CHECK_VIOLATION);
        });

        it('admits EACH arm alone — the positive control for both refusals', async () => {
            const root = insert([`${SCOPE}-root`, null]);
            const variant = insert([null, `${SCOPE}-variant`]);

            expect((await pool.query(root.text, root.values)).rowCount).toBe(1);
            expect((await pool.query(variant.text, variant.values)).rowCount).toBe(1);
        });
    });

    it('serves the live VARIANT lookup from its own partial index, beside the root one', async () => {
        const { rows } = await pool.query<{ indexdef: string }>(
            `SELECT indexdef FROM pg_indexes
              WHERE tablename = 'ingredient_resolution_mappings'
                AND indexname = 'idx_resolution_mappings_live_variant_lookup'`,
        );

        expect(rows[0]?.indexdef).toMatch(/\(normalized_key, food_variant_id\)/u);
        expect(rows[0]?.indexdef).toMatch(/WHERE \(\(superseded_at IS NULL\) AND \(food_variant_id IS NOT NULL\)\)/u);
    });

    describe('the repository reads and writes the arc (curated U9, P3b)', () => {
        const ROOT = { kind: 'root', id: `${SCOPE}-shared-id` } as const satisfies FoodRef;
        const VARIANT = { kind: 'variant', id: `${SCOPE}-shared-id` } as const satisfies FoodRef;

        /** A mapping key under this file's scope. */
        function scopedKey(phrase: string) {
            const key = normalizedIngredientKey(`${SCOPE} ${phrase}`);

            if (key === undefined) {
                throw new Error('fixture phrase must normalize');
            }

            return key;
        }

        /** One author's correction, through the real read → decide → write path. */
        async function correct(dal: ResolutionMappingsDal, phrase: string, userId: string, food: FoodRef) {
            const normalizedKey = scopedKey(phrase);

            return dal.runInTransaction(async (tx) => {
                const facts = await dal.findWriteFacts(
                    normalizedKey,
                    userId,
                    food,
                    { excludeTestPrincipals: true },
                    tx,
                );
                const decision = evaluateMappingWrite({
                    principalKind: 'real',
                    containment: 'enforce',
                    correctedFood: food,
                    grantedScopes: [],
                    ...facts,
                });

                return dal.applyWrite(
                    { decision, normalizedKey, sourcePhrase: phrase, food, userId, surfacing: 'ingredient_picker' },
                    tx,
                );
            });
        }

        it('a correction to a VARIANT is the mapping in force, read back as that variant', async () => {
            const dal = new ResolutionMappingsDal(createRecipeDrizzle(pool));

            await correct(dal, 'tomato paste', `${SCOPE}-user-1`, VARIANT);

            expect((await dal.findInForce(scopedKey('tomato paste'), `${SCOPE}-user-1`))?.food).toStrictEqual(VARIANT);
        });

        it('⛔ a ROOT and a VARIANT sharing an id string never corroborate — the arc is compared on both columns', async () => {
            const dal = new ResolutionMappingsDal(createRecipeDrizzle(pool));

            await correct(dal, 'brisket flat', `${SCOPE}-user-a`, ROOT);
            const second = await correct(dal, 'brisket flat', `${SCOPE}-user-b`, VARIANT);

            expect(second.written && second.promotion).toBeUndefined();
        });

        it('two authors agreeing on the SAME variant promote it, and the global binding names the variant', async () => {
            const dal = new ResolutionMappingsDal(createRecipeDrizzle(pool));

            await correct(dal, 'paste of tomato', `${SCOPE}-user-c`, VARIANT);
            const second = await correct(dal, 'paste of tomato', `${SCOPE}-user-d`, VARIANT);

            expect(second.written && second.promotion).toBeDefined();
            expect((await dal.findInForce(scopedKey('paste of tomato'), undefined))?.food).toStrictEqual(VARIANT);
        });

        it('the memo tier reads a remembered VARIANT, exact and near', async () => {
            const dal = new ResolutionMappingsDal(createRecipeDrizzle(pool));
            const key = scopedKey('sun dried tomato paste');

            await pool.query(
                `INSERT INTO ingredient_resolution_memos (normalized_key, food_variant_id, source_phrase, verified_by)
                 VALUES ($1, $2, $1, 'e2e-model')`,
                [key, VARIANT.id],
            );

            expect(await dal.findMemo(key)).toStrictEqual({ food: VARIANT, match: 'exact', similarity: 1 });
            expect((await dal.findMemo(scopedKey('sun dried tomato pastes')))?.food).toStrictEqual(VARIANT);
        });
    });
});
