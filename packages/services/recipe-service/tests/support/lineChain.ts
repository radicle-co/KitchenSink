/**
 * Fixture writers for the recipe-line chain (migration 0051): a recipe LINE (`ingredients`) points at a BINDING
 * (`food_lookups`), and a binding names exactly one of a root food, a variant, or a failure record
 * (`unresolved_foods`). Integration suites that seed lines straight into Postgres build that chain here, so no
 * suite spells the three-table insert its own way.
 *
 * Three arms are offered, the three a recipe line meets in practice:
 *
 * - `shared` — a catalog food anyone may read (`food_id`, no owner).
 * - `private` — a cook's PRIVATE authored food (`food_id` + `food_owner_id`).
 * - `declared` — a name the cook asked for as written (`unresolved_foods.reason_code = 'author_declared'`), the
 *   only arm that carries its own name. Its `normalized_key` is computed by the same `normalizedIngredientKey`
 *   the service's declare path uses, so a fixture row is the row production would write.
 *
 * ⛔ The binding writer is IDEMPOTENT for a caller-chosen id and REFUSES a collision rather than reusing a row that
 * is not the one asked for. `food_id` is unique across the whole table, so a second suite binding the same food
 * id — or the same suite asking for it under another owner — would otherwise be handed a row on the wrong arm,
 * and a private fixture would silently become a shared one.
 *
 * ⚠️ Cleanup order is fixed by the foreign keys, which are `RESTRICT`: delete the recipes (their lines cascade),
 * then the bindings and their failure records — `deleteBindingsMatching` (`bindingCleanup.ts`) does the last two.
 * `DELETE FROM ingredients` now deletes every recipe LINE in the database, seeded ones included — scope every
 * delete to the suite's own rows.
 */
import type pg from 'pg';

import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

/** Anything that runs a parameterised statement: a pool, or a client inside a transaction. */
export type SqlExecutor = Pick<pg.Pool, 'query'>;

/** The binding a fixture line points at. `id` pins the binding's primary key, which a suite puts on the wire. */
export type FixtureLookup =
    | { readonly arm: 'shared'; readonly foodId: string; readonly id?: string }
    | { readonly arm: 'private'; readonly foodId: string; readonly ownerId: string; readonly id?: string }
    | { readonly arm: 'declared'; readonly name: string; readonly id?: string };

/** The columns of one recipe line a fixture may set. Everything absent takes the table's own default. */
export interface FixtureLine {
    /** Pins the line's primary key. */
    readonly id?: string;
    /** `null` is the one spelling of "the source stated no amount". */
    readonly quantity: number | string | null;
    readonly quantityHigh?: number | string | null;
    /** `''` is the unitless spelling the table stores. */
    readonly unit: string;
    readonly displayText?: string | null;
    readonly sourceLine?: string | null;
    readonly sourcePhrase?: string | null;
    readonly statedQuantity?: number | string | null;
    readonly statedQuantityHigh?: number | string | null;
    readonly statedUnit?: string | null;
    readonly preparation?: string | null;
    readonly groupLabel?: string | null;
    readonly sortOrder?: number;
    readonly userCalories?: number | string | null;
    readonly userProteinG?: number | string | null;
    readonly userCarbsG?: number | string | null;
    readonly userFatG?: number | string | null;
}

/** One line plus the recipe and binding it belongs to. */
export interface FixtureLineInsert extends FixtureLine {
    readonly recipeId: string;
    readonly foodLookupId: string;
}

/** Every optional line column, mapped to its SQL name. The order is the INSERT's column order. */
const LINE_COLUMNS = {
    id: 'id',
    quantityHigh: 'quantity_high',
    displayText: 'display_text',
    sourceLine: 'source_line',
    sourcePhrase: 'source_phrase',
    statedQuantity: 'stated_quantity',
    statedQuantityHigh: 'stated_quantity_high',
    statedUnit: 'stated_unit',
    preparation: 'preparation',
    groupLabel: 'group_label',
    sortOrder: 'sort_order',
    userCalories: 'user_calories',
    userProteinG: 'user_protein_g',
    userCarbsG: 'user_carbs_g',
    userFatG: 'user_fat_g',
} as const satisfies Record<Exclude<keyof FixtureLine, 'quantity' | 'unit'>, string>;

/** A binding as read back, with the failure record it names on the declared arm. */
interface StoredLookup {
    readonly id: string;
    readonly food_id: string | null;
    readonly food_variant_id: string | null;
    readonly food_owner_id: string | null;
    readonly declared_name: string | null;
    readonly reason_code: string | null;
}

/** The one read of a binding, so every arm is verified against the same projection. */
const STORED_LOOKUP_SELECT = `
    SELECT l.id, l.food_id, l.food_variant_id, l.food_owner_id, u.name AS declared_name, u.reason_code
      FROM food_lookups l
      LEFT JOIN unresolved_foods u ON u.id = l.unresolved_food_id`;

/**
 * Whether a stored binding is exactly the one a fixture asked for.
 *
 * @param row - The stored binding.
 * @param lookup - What the fixture asked for.
 * @returns `true` when the arm, food, owner and (for a declaration) name all match. Pure.
 */
function matches(row: StoredLookup, lookup: FixtureLookup): boolean {
    if (lookup.id !== undefined && row.id !== lookup.id) {
        return false;
    }

    if (lookup.arm === 'declared') {
        return row.reason_code === 'author_declared' && row.declared_name === lookup.name;
    }

    const owner = lookup.arm === 'private' ? lookup.ownerId : null;

    return row.food_id === lookup.foodId && row.food_variant_id === null && row.food_owner_id === owner;
}

/**
 * The single stored binding a fixture resolved to, refusing none and refusing a mismatch.
 *
 * @param rows - Every binding the read found.
 * @param lookup - What the fixture asked for.
 * @returns The binding's id.
 * @throws {Error} when no row, more than one row, or a row on another arm, food or owner was found. Pure.
 */
function exactlyTheOneAskedFor(rows: readonly StoredLookup[], lookup: FixtureLookup): string {
    const [row] = rows;

    if (rows.length !== 1 || row === undefined || !matches(row, lookup)) {
        throw new Error(
            `fixture binding collision: asked for ${JSON.stringify(lookup)}, the database holds ${JSON.stringify(rows)}`,
        );
    }

    return row.id;
}

/**
 * The key a declared name is stored under — the service's own normalizer.
 *
 * @param name - The declared name.
 * @returns The key.
 * @throws {Error} when the name has no visible content, which the service would refuse too. Pure.
 */
function declaredKeyOf(name: string): string {
    const key = normalizedIngredientKey(name);

    if (key === undefined) {
        throw new Error(`fixture declared name ${JSON.stringify(name)} has no visible content`);
    }

    return key;
}

/**
 * Find or create a food-bound binding (the `shared` or `private` arm).
 *
 * @param executor - Where to write.
 * @param lookup - The binding asked for.
 * @returns The binding's id.
 * @sideEffect Inserts a `food_lookups` row unless one already matches.
 */
async function ensureBoundLookup(
    executor: SqlExecutor,
    lookup: Extract<FixtureLookup, { readonly arm: 'shared' | 'private' }>,
): Promise<string> {
    const owner = lookup.arm === 'private' ? lookup.ownerId : null;

    // Untargeted: the fixed id and the `food_id` unique index are both conflict targets, and either one means
    // "a row is already there" — which the read below then checks is the RIGHT row.
    await executor.query(
        `INSERT INTO food_lookups (id, food_id, food_owner_id)
              VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3)
         ON CONFLICT DO NOTHING`,
        [lookup.id ?? null, lookup.foodId, owner],
    );

    const { rows } = await executor.query<StoredLookup>(`${STORED_LOOKUP_SELECT} WHERE l.id = $1 OR l.food_id = $2`, [
        lookup.id ?? null,
        lookup.foodId,
    ]);

    return exactlyTheOneAskedFor(rows, lookup);
}

/**
 * Create a declared binding (the `declared` arm) — or, for a pinned id already present, verify it.
 *
 * Without a pinned id every call creates a NEW failure record and binding: two declarations of one name never
 * converge (`unresolved_foods_shared_failure_key_idx` exempts `author_declared`), exactly as in production.
 *
 * @param executor - Where to write.
 * @param lookup - The binding asked for.
 * @returns The binding's id.
 * @sideEffect Inserts an `unresolved_foods` row and its `food_lookups` row, in one statement.
 */
async function ensureDeclaredLookup(
    executor: SqlExecutor,
    lookup: Extract<FixtureLookup, { readonly arm: 'declared' }>,
): Promise<string> {
    // One statement, so the failure record is written ONLY when its binding is: a two-step insert against a
    // pinned id that already exists would mint an orphaned failure record on every run.
    const inserted = await executor.query<{ id: string }>(
        `WITH bound AS (
             SELECT id FROM food_lookups WHERE id = $1::uuid
         ),
         declared AS (
             INSERT INTO unresolved_foods (name, normalized_key, reason_code)
             SELECT $2, $3, 'author_declared'
              WHERE NOT EXISTS (SELECT 1 FROM bound)
             RETURNING id
         )
         INSERT INTO food_lookups (id, unresolved_food_id)
         SELECT COALESCE($1::uuid, gen_random_uuid()), declared.id FROM declared
         RETURNING id`,
        [lookup.id ?? null, lookup.name, declaredKeyOf(lookup.name)],
    );

    // A pinned id that already existed inserted nothing; either way the row is read back through the same
    // projection, so its arm and name are verified rather than assumed.
    const id = lookup.id ?? inserted.rows[0]?.id;

    if (id === undefined) {
        throw new Error(`fixture declaration ${JSON.stringify(lookup.name)} returned no binding`);
    }

    const { rows } = await executor.query<StoredLookup>(`${STORED_LOOKUP_SELECT} WHERE l.id = $1`, [id]);

    return exactlyTheOneAskedFor(rows, lookup);
}

/**
 * Find or create the binding a fixture line points at.
 *
 * @param executor - Where to write.
 * @param lookup - The binding asked for.
 * @returns The binding's id.
 * @throws {Error} when a row already holds the pinned id or the food id on another arm, food or owner.
 * @sideEffect Inserts into `food_lookups` (and `unresolved_foods` for a declaration).
 */
export async function ensureFoodLookup(executor: SqlExecutor, lookup: FixtureLookup): Promise<string> {
    return lookup.arm === 'declared' ? ensureDeclaredLookup(executor, lookup) : ensureBoundLookup(executor, lookup);
}

/**
 * Insert one recipe line against an existing binding.
 *
 * @param executor - Where to write.
 * @param line - The line, its recipe and its binding.
 * @returns The line's id.
 * @sideEffect Inserts one `ingredients` row.
 */
export async function insertIngredientLine(executor: SqlExecutor, line: FixtureLineInsert): Promise<string> {
    const columns = ['recipe_id', 'food_lookup_id', 'quantity', 'unit'];
    const values: unknown[] = [line.recipeId, line.foodLookupId, line.quantity, line.unit];

    for (const [key, column] of Object.entries(LINE_COLUMNS) as [keyof typeof LINE_COLUMNS, string][]) {
        const value = line[key];

        if (value !== undefined) {
            columns.push(column);
            values.push(value);
        }
    }

    const { rows } = await executor.query<{ id: string }>(
        `INSERT INTO ingredients (${columns.join(', ')})
              VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})
         RETURNING id`,
        values,
    );
    const [row] = rows;

    if (row === undefined) {
        throw new Error(`fixture line insert for recipe ${line.recipeId} returned no row`);
    }

    return row.id;
}

/** A failure record as stored, read through the binding that points at it. */
export interface StoredFailureRecord {
    readonly name: string;
    readonly reasonCode: string;
    /** The generated status — read, never written. */
    readonly status: string;
    readonly foodHandleId: string | null;
}

/**
 * Read the failure record a binding points at, straight from the database rather than through the code under test.
 *
 * @param executor - Where to read.
 * @param lookupId - The binding.
 * @returns The record, or `undefined` when the binding does not exist or is not on the unresolved arm.
 * @sideEffect One SELECT.
 */
export async function readFailureRecord(
    executor: SqlExecutor,
    lookupId: string,
): Promise<StoredFailureRecord | undefined> {
    const { rows } = await executor.query<StoredFailureRecord>(
        `SELECT u.name, u.reason_code AS "reasonCode", u.status, u.food_handle_id AS "foodHandleId"
           FROM food_lookups l
           JOIN unresolved_foods u ON u.id = l.unresolved_food_id
          WHERE l.id = $1`,
        [lookupId],
    );

    return rows[0];
}
