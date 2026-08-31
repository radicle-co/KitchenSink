/**
 * `AuthoredFoodsDao` (plan U10, D8/D9a/KTD-H) — the write path for USER-AUTHORED foods, and nothing else.
 *
 * DESIGN PATTERN: Repository, deliberately SEPARATE from `FoodDao`: that class is the PIPELINE's writer
 * (dedup-by-name admission, guarded lifecycle transitions, golden-scalar merges), and an authored food
 * follows none of those rules — it is born `RESOLVED`, has no crosswalk row, no candidates, no queue row,
 * and exactly one writer (its author). Mixing the two write disciplines into one class is how the
 * single-writer ruling would erode one convenience method at a time.
 *
 * ## What a created row looks like, structurally (KTD-H)
 *
 *  - `food`: `user_id` = the author, `visibility` = 'private' (Q3c — promotion is U12's), status
 *    `RESOLVED` (there is nothing to resolve; the author IS the source), NO `food_sources` row — which
 *    keeps it out of both refresh scans by construction.
 *  - `food_nutrients`: the four macro rows (Q3a), `source_id` NULL (0013 made value provenance nullable;
 *    NULL means "the food's author wrote this"). Dictionary identities come from
 *    {@link LABEL_NUTRIENT_MAP} — the SAME `{name, unit}` rows the USDA merge resolves against, so the
 *    recipe side's nutrition projection reads authored macros through the very code path it already has.
 *  - `food_portions`: optional household measures, `source_id` NULL.
 *
 * ## Dedup (KTD-H's per-author partial unique)
 *
 * The database is the authority: `food_normalized_name_per_author_unique` rejects a second row for the
 * same `(normalized_name, user_id)`. This DAO surfaces that as {@link AuthoredCreateResult}'s
 * `duplicate` arm — resolved INSIDE the transaction by re-reading the existing row — rather than letting
 * a 23505 escape as a 500.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';

/** The transaction view of {@link FoodDrizzle} — the `mergeAndPersist.service.ts` alias, restated locally. */
type FoodTransaction = Parameters<Parameters<FoodDrizzle['transaction']>[0]>[0];
import { food, foodNutrients, foodPortions } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';
import { NutrientDao } from './nutrient.dao.js';
import { isUniqueViolation } from './dao.errors.js';
import { LABEL_NUTRIENT_MAP } from '../nutrition/labelNutrientMap.js';

/** The authored macros, per 100g (Q3a: macros-only at launch). */
export interface AuthoredMacrosInput {
    readonly calories: number;
    readonly proteinG: number;
    readonly carbsG: number;
    readonly fatG: number;
}

/** One authored household portion. */
export interface AuthoredPortionRow {
    readonly label: string;
    readonly gramWeight: number;
}

/** Input for {@link AuthoredFoodsDao.createAuthored}. */
export interface CreateAuthoredInput {
    /** The author's app-user ULID. */
    readonly userId: string;
    /** Display name. */
    readonly name: string;
    /** The dedup key (`normalizeName(name)`), computed by the service. */
    readonly normalizedName: string;
    readonly description: string | null;
    readonly macros: AuthoredMacrosInput;
    readonly portions: readonly AuthoredPortionRow[];
}

/** The create outcome: the new id, or the existing row the per-author unique rejected it against. */
export type AuthoredCreateResult =
    { readonly kind: 'created'; readonly id: string } | { readonly kind: 'duplicate'; readonly existingId: string };

/** The two 0013 columns the authorship policy decides over, plus the name for dedup-on-rename. */
export interface AuthorshipFacts {
    readonly userId: string | null;
    readonly visibility: 'public' | 'private' | 'promoted';
}

/** The four macro rows, in a stable order, resolved to the canonical dictionary identities. */
const MACRO_LABELS = [
    { key: 'calories' as const, identity: LABEL_NUTRIENT_MAP.calories },
    { key: 'proteinG' as const, identity: LABEL_NUTRIENT_MAP.protein },
    { key: 'carbsG' as const, identity: LABEL_NUTRIENT_MAP.carbohydrates },
    { key: 'fatG' as const, identity: LABEL_NUTRIENT_MAP.fat },
];

export class AuthoredFoodsDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Create an authored food: the row, its four macro values, and its portions, in ONE transaction.
     *
     * @param input - The author, names, macros and portions.
     * @returns `created` with the new id, or `duplicate` with the colliding row's id.
     * @sideEffect Writes `food`, `food_nutrients`, `food_portions` (and possibly the `nutrient` dictionary).
     */
    public async createAuthored(input: CreateAuthoredInput): Promise<AuthoredCreateResult> {
        try {
            return await this.db.transaction(async (tx) => {
                const id = newFoodId();

                await tx.insert(food).values({
                    id,
                    name: input.name,
                    normalizedName: input.normalizedName,
                    description: input.description,
                    status: 'RESOLVED',
                    userId: input.userId,
                    visibility: 'private',
                });
                await this.writeValues(tx, id, input.macros, input.portions);

                return { kind: 'created', id };
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                const existing = await this.db
                    .select({ id: food.id })
                    .from(food)
                    .where(and(eq(food.normalizedName, input.normalizedName), eq(food.userId, input.userId)));
                const existingId = existing[0]?.id;

                if (existingId !== undefined) {
                    return { kind: 'duplicate', existingId };
                }
            }

            throw error;
        }
    }

    /**
     * Replace an authored food's content wholesale (PUT semantics — "the author may edit EVERYTHING").
     *
     * ⚠️ The caller has ALREADY passed `evaluateAuthorship`; this method re-asserts only the structural
     * facts (`user_id` matches, so a raced delete/erasure loses cleanly with `replaced: false`).
     *
     * @param input - The same shape as create, plus the food id.
     * @returns `replaced: false` when no owned row matched (raced away), `duplicate` on a rename collision.
     * @sideEffect Rewrites the food's scalars, macro values and portions.
     */
    public async replaceAuthored(
        input: CreateAuthoredInput & { readonly id: string },
    ): Promise<
        | { readonly kind: 'replaced' }
        | { readonly kind: 'missing' }
        | { readonly kind: 'duplicate'; readonly existingId: string }
    > {
        try {
            return await this.db.transaction(async (tx) => {
                const updated = await tx
                    .update(food)
                    .set({
                        name: input.name,
                        normalizedName: input.normalizedName,
                        description: input.description,
                        updatedAt: sql`now()`,
                    })
                    .where(and(eq(food.id, input.id), eq(food.userId, input.userId)))
                    .returning({ id: food.id });

                if (updated.length === 0) {
                    return { kind: 'missing' };
                }

                // Full replacement: delete-and-reinsert is the PUT semantics, and both tables are small
                // (≤ 4 macros + ≤ 10 portions).
                await tx
                    .delete(foodNutrients)
                    .where(and(eq(foodNutrients.foodId, input.id), isNull(foodNutrients.sourceId)));
                await tx
                    .delete(foodPortions)
                    .where(and(eq(foodPortions.foodId, input.id), isNull(foodPortions.sourceId)));
                await this.writeValues(tx, input.id, input.macros, input.portions);

                return { kind: 'replaced' };
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                const existing = await this.db
                    .select({ id: food.id })
                    .from(food)
                    .where(and(eq(food.normalizedName, input.normalizedName), eq(food.userId, input.userId)));
                const existingId = existing[0]?.id;

                if (existingId !== undefined && existingId !== input.id) {
                    return { kind: 'duplicate', existingId };
                }
            }

            throw error;
        }
    }

    /**
     * The two columns `evaluateAuthorship` decides over, or `undefined` when the food does not exist.
     *
     * @sideEffect Reads `food`.
     */
    public async readAuthorshipFacts(id: string): Promise<AuthorshipFacts | undefined> {
        const rows = await this.db
            .select({ userId: food.userId, visibility: food.visibility })
            .from(food)
            .where(eq(food.id, id));
        const row = rows[0];

        if (row === undefined) {
            return undefined;
        }

        // The 0013 CHECK guarantees coherence; the narrow here is honesty about the text column.
        if (row.visibility !== 'public' && row.visibility !== 'private' && row.visibility !== 'promoted') {
            throw new Error(`unknown food visibility '${row.visibility}'`);
        }

        return { userId: row.userId, visibility: row.visibility };
    }

    /** The macro + portion writes shared by create and replace. @sideEffect Writes value rows. */
    private async writeValues(
        tx: FoodTransaction,
        foodId: string,
        macros: AuthoredMacrosInput,
        portions: readonly AuthoredPortionRow[],
    ): Promise<void> {
        // `NutrientDao` is typed over the client; a drizzle transaction exposes the same query surface
        // minus `$client`, which the DAO never touches — `mergeAndPersist.service.ts`'s `asDaoDb` cast,
        // restated for the same reason at the same seam.
        const nutrients = new NutrientDao(tx as unknown as FoodDrizzle);

        for (const { key, identity } of MACRO_LABELS) {
            const dictionary = await nutrients.resolveOrCreate({ name: identity.name, unit: identity.unit });

            await tx.insert(foodNutrients).values({
                id: newFoodId(),
                foodId,
                nutrientId: dictionary.id,
                amount: String(macros[key]),
                basis: 'per_100g',
                sourceId: null,
            });
        }

        for (const portion of portions) {
            await tx.insert(foodPortions).values({
                id: newFoodId(),
                foodId,
                label: portion.label,
                gramWeight: String(portion.gramWeight),
                sourceId: null,
            });
        }
    }
}
