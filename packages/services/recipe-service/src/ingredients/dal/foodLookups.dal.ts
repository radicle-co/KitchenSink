/**
 * The repository over a line's BINDING (`food_lookups`) and the failure record an unresolved binding points at
 * (`unresolved_foods`) — migration 0051, plan 002 U3.
 *
 * It owns every statement that writes a binding, and each promise it makes is a property of the SQL:
 * - **One lookup per food, found or created, never updated** (R12, R13). A second bind of the same food lands on
 *   the existing row through the partial unique index, and a found row is returned exactly as it stands, so no
 *   later bind can change what another cook's line reads. Concurrent binds converge on one row (AE19).
 * - **Failures converge; declarations never do** (R11). A non-declared failure converges on its normalized key
 *   through the partial unique index; the attempt is merged by `mergeAttempt`'s rule (R2) with a
 *   compare-and-swap, so a lost race re-reads instead of overwriting.
 * - **Settling is a repoint, never a delete** (R13). Every line on a failure moves to the bound root, and only a
 *   {@link ResolvedHandle} — food's answer about the failure's own pending food or phrase — can ask for it.
 * - **A failure is deleted only when nothing references it** (R14), and only on the explicit rebind path.
 *
 * It never selects `unresolved_foods.detail`, which is operator-only (R5), so no read path can carry it to a
 * client. Rows are parsed through the ONE arm reader, `foodLookupArmOf`.
 *
 * @pattern Repository — over the binding and its failure record, returning parsed arms
 * @sideEffect Every method reads and/or writes Postgres.
 */
import { and, eq, getTableColumns, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import type { RecipeDrizzle } from '../../database/client.js';
import { postgresErrorOf } from '../../database/postgresError.js';
import {
    failureFactsOf,
    foodLookupArmOf,
    type FoodLookupArm,
    type RootArm,
    type UnresolvedArm,
} from '../../database/schema/foodLookupArm.js';
import { foodLookups, ingredients, unresolvedFoods } from '../../database/schema/index.js';
import type { Writer } from '../../database/unitOfWork.js';
import type { FoodAdmission, ResolvedHandle } from '../domain/foodAdmission.js';
import { mergeAttempt, type FailureUpdate, type NewFailure } from '../domain/failureOutcome.js';

/** A read-only surface satisfied by the client and a transaction handle. */
type Reader = Pick<RecipeDrizzle, 'select'>;

/** Every failure column except the operator-only `detail`. */
const { detail: _operatorOnly, ...FAILURE_COLUMNS } = getTableColumns(unresolvedFoods);

/** How many times a failure merge re-reads after losing its compare-and-swap before it stops counting. */
const MAX_MERGE_ATTEMPTS = 3;

/** SQLSTATEs a conditional delete meets when a concurrent writer referenced the row first. */
const REFERENCED_SQLSTATES: ReadonlySet<string> = new Set(['23001', '23503']);

/**
 * Whether a conditional delete was refused because a concurrent writer referenced the row first.
 *
 * @param error - What the delete threw.
 * @returns `true` for a Postgres refusal under one of {@link REFERENCED_SQLSTATES}. Pure.
 */
function isReferencedRefusal(error: unknown): boolean {
    const code = postgresErrorOf(error)?.code;

    return code !== undefined && REFERENCED_SQLSTATES.has(code);
}

/**
 * The root arm a statement just wrote or read.
 *
 * @param arm - The parsed arm.
 * @returns It, as a root arm.
 * @throws {Error} when the row read back is another kind — a defect in the statement. Pure.
 */
function asRoot(arm: FoodLookupArm): RootArm {
    if (arm.kind !== 'root') {
        throw new Error(`food_lookups row ${arm.lookupId} read back as ${arm.kind}, expected root`);
    }

    return arm;
}

/**
 * The unresolved arm a statement just wrote or read.
 *
 * @param arm - The parsed arm.
 * @returns It, as an unresolved arm.
 * @throws {Error} when the row read back is another kind — a defect in the statement. Pure.
 */
function asUnresolved(arm: FoodLookupArm): UnresolvedArm {
    if (arm.kind !== 'unresolved') {
        throw new Error(`food_lookups row ${arm.lookupId} read back as ${arm.kind}, expected unresolved`);
    }

    return arm;
}

export class FoodLookupsDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Load bindings by id, each parsed into its arm.
     *
     * @param ids - Lookup ids.
     * @param reader - An enlisting transaction, or the client.
     * @returns Arms by lookup id; an unknown id is simply absent.
     * @sideEffect One `food_lookups LEFT JOIN unresolved_foods` read.
     */
    public async findByIds(
        ids: readonly string[],
        reader: Reader = this.db,
    ): Promise<ReadonlyMap<string, FoodLookupArm>> {
        const unique = [...new Set(ids)];

        if (unique.length === 0) {
            return new Map();
        }

        const rows = await reader
            .select({ lookup: foodLookups, failure: FAILURE_COLUMNS })
            .from(foodLookups)
            .leftJoin(unresolvedFoods, eq(unresolvedFoods.id, foodLookups.unresolvedFoodId))
            .where(inArray(foodLookups.id, unique));

        return new Map(
            rows.map((row) => [row.lookup.id, foodLookupArmOf({ lookup: row.lookup, failure: row.failure })]),
        );
    }

    /**
     * The root bindings of the given foods that `callerId` may see: shared ones, and the caller's own private
     * ones (R20).
     *
     * @param foodIds - Food ids.
     * @param callerId - The viewer, or `undefined` for none (shared bindings only).
     * @returns Root arms by food id.
     * @sideEffect One `food_lookups` read.
     */
    public async findBoundRootsByFoodIds(
        foodIds: readonly string[],
        callerId: string | undefined,
    ): Promise<ReadonlyMap<string, RootArm>> {
        const unique = [...new Set(foodIds)];

        if (unique.length === 0) {
            return new Map();
        }

        const visible =
            callerId === undefined
                ? isNull(foodLookups.foodOwnerId)
                : or(isNull(foodLookups.foodOwnerId), eq(foodLookups.foodOwnerId, callerId));
        const rows = await this.db
            .select()
            .from(foodLookups)
            .where(and(inArray(foodLookups.foodId, unique), visible));

        return new Map(
            rows.map((lookup) => {
                const arm = asRoot(foodLookupArmOf({ lookup, failure: null }));

                return [arm.foodId, arm];
            }),
        );
    }

    /**
     * The owner of each PRIVATE root binding among the given foods, whoever the owner is. A shared binding and an
     * unbound food are absent.
     *
     * The batch nutrition endpoint reads this to hide another user's private food behind the answer an unknown id
     * gets (plan 002 R46, R50). It compares each owner with the caller itself, so this read takes no caller.
     *
     * @param foodIds - Food ids.
     * @returns Owner ids by food id.
     * @sideEffect One `food_lookups` read.
     */
    public async findPrivateRootOwners(foodIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
        const unique = [...new Set(foodIds)];

        if (unique.length === 0) {
            return new Map();
        }

        const rows = await this.db
            .select({ foodId: foodLookups.foodId, ownerId: foodLookups.foodOwnerId })
            .from(foodLookups)
            .where(and(inArray(foodLookups.foodId, unique), isNotNull(foodLookups.foodOwnerId)));

        return new Map(
            rows.flatMap((row) => (row.foodId === null || row.ownerId === null ? [] : [[row.foodId, row.ownerId]])),
        );
    }

    /**
     * The converged failure record for a normalized key, when one exists. Declarations never converge, so they
     * are never found here.
     *
     * @param normalizedKey - The phrase's key.
     * @returns The failure's arm, or `undefined`.
     * @sideEffect One read.
     */
    public async findConvergedFailure(normalizedKey: string): Promise<UnresolvedArm | undefined> {
        const [row] = await this.db
            .select({ lookup: foodLookups, failure: FAILURE_COLUMNS })
            .from(unresolvedFoods)
            .innerJoin(foodLookups, eq(foodLookups.unresolvedFoodId, unresolvedFoods.id))
            .where(
                and(
                    eq(unresolvedFoods.normalizedKey, normalizedKey),
                    ne(unresolvedFoods.reasonCode, 'author_declared'),
                ),
            )
            .limit(1);

        // Index-bound: `noUncheckedIndexedAccess` is OFF, so the destructured row types as present.
        if (row === undefined) {
            return undefined;
        }

        return asUnresolved(foodLookupArmOf(row));
    }

    /**
     * Find or create the ONE binding for an admitted root food. A found row is returned as it stands and never
     * updated (R13).
     *
     * @param admission - Proof that the food may be bound.
     * @param writer - An enlisting transaction, or the client.
     * @returns The root arm.
     * @sideEffect At most one insert and one read on `food_lookups`.
     */
    public async findOrCreateBoundRoot(admission: FoodAdmission, writer: Writer = this.db): Promise<RootArm> {
        const [created] = await writer
            .insert(foodLookups)
            .values({ foodId: admission.foodId, foodOwnerId: admission.ownerId })
            .onConflictDoNothing({ target: foodLookups.foodId, where: isNotNull(foodLookups.foodId) })
            .returning();

        const lookup =
            created ??
            (await writer.select().from(foodLookups).where(eq(foodLookups.foodId, admission.foodId)).limit(1))[0];

        if (lookup === undefined) {
            throw new Error(`food_lookups has no row for food ${admission.foodId} after a conflicting insert`);
        }

        return asRoot(foodLookupArmOf({ lookup, failure: null }));
    }

    /**
     * Record a failure: a declaration always gets its own record; any other failure converges on its phrase's
     * record and merges the attempt by R2's rule.
     *
     * @param failure - The failure to record.
     * @returns The binding the line should point at.
     * @sideEffect Inserts a failure and its binding in one transaction, or updates the converged failure.
     */
    public async recordFailure(failure: NewFailure): Promise<UnresolvedArm> {
        const created = await this.db.transaction(async (tx) => {
            const insert = tx.insert(unresolvedFoods).values({
                name: failure.name,
                sourcePhrase: failure.sourcePhrase,
                normalizedKey: failure.normalizedKey,
                reasonCode: failure.reasonCode,
                foodHandleId: failure.foodHandleId,
                tiersConsulted: [...failure.tiersConsulted],
                tiersUnavailable: [...failure.tiersUnavailable],
                detail: failure.detail,
            });
            const [inserted] =
                failure.reasonCode === 'author_declared'
                    ? await insert.returning(FAILURE_COLUMNS)
                    : await insert
                          .onConflictDoNothing({
                              target: unresolvedFoods.normalizedKey,
                              where: sql`${unresolvedFoods.reasonCode} <> 'author_declared'`,
                          })
                          .returning(FAILURE_COLUMNS);

            if (inserted === undefined) {
                return undefined;
            }

            const [lookup] = await tx.insert(foodLookups).values({ unresolvedFoodId: inserted.id }).returning();

            if (lookup === undefined) {
                throw new Error(`food_lookups insert for failure ${inserted.id} returned no row`);
            }

            return asUnresolved(foodLookupArmOf({ lookup, failure: inserted }));
        });

        return created ?? this.mergeIntoConverged(failure);
    }

    /**
     * Count an attempt on an existing failure, and replace its facts when the update says so. A compare-and-swap
     * on `(attempts, reason_code)`: a concurrent attempt makes it match nothing, and so does a settle.
     *
     * @param arm - The failure as last read.
     * @param update - What the attempt changes.
     * @returns The failure as written, or `undefined` when another attempt won the race (re-read and retry) or a
     *   settle freed the failure (re-read: it now names its target).
     * @sideEffect One conditional update of `unresolved_foods`.
     */
    public async recordAttempt(arm: UnresolvedArm, update: FailureUpdate): Promise<UnresolvedArm | undefined> {
        const facts =
            update.kind === 'replace'
                ? {
                      reasonCode: update.failure.reasonCode,
                      foodHandleId: update.failure.foodHandleId,
                      tiersConsulted: [...update.failure.tiersConsulted],
                      tiersUnavailable: [...update.failure.tiersUnavailable],
                      detail: update.failure.detail,
                  }
                : {};
        const [written] = await this.db
            .update(unresolvedFoods)
            .set({ ...facts, attempts: sql`${unresolvedFoods.attempts} + 1`, lastAttemptedAt: sql`now()` })
            .where(
                and(
                    eq(unresolvedFoods.id, arm.failure.unresolvedFoodId),
                    eq(unresolvedFoods.attempts, arm.failure.attempts),
                    eq(unresolvedFoods.reasonCode, arm.failure.reasonCode),
                    // A settle is final: a settled failure records no attempt.
                    isNull(unresolvedFoods.settledLookupId),
                ),
            )
            .returning(FAILURE_COLUMNS);

        if (written === undefined) {
            return undefined;
        }

        return { ...arm, failure: failureFactsOf(arm.lookupId, written) };
    }

    /**
     * Move every line on a shared failure to the bound root, and record the root on the failure. Deletes nothing
     * (R13).
     *
     * ⛔ One transaction, and it LOCKS the failure record first. A settle mints no recipe version, so a save built
     * before it still names the failure; the line write forwards through `settled_lookup_id` under a `FOR SHARE`
     * read of the same row (`IngredientLinesDal.replaceForRecipe`). The two locks order the pair both ways: a save
     * already holding the row makes this wait and then move its committed line, and a save arriving after the lock
     * waits and then reads the pointer. Without it, a save committing mid-settle leaves its line on the failure.
     *
     * @param handle - Food's proof that it resolved the failure's own pending food or phrase.
     * @param bound - The root binding the lines move to.
     * @returns How many lines moved: `0` when another settle got there first, which is final.
     * @sideEffect One transaction: a row lock, an update of `ingredients` and one of `unresolved_foods`.
     */
    public async settleFailure(handle: ResolvedHandle, bound: RootArm): Promise<number> {
        return this.db.transaction(async (tx) => {
            const [locked] = await tx
                .select({ settledLookupId: unresolvedFoods.settledLookupId })
                .from(unresolvedFoods)
                .where(eq(unresolvedFoods.id, handle.unresolvedFoodId))
                .for('update');

            // A settle is final: a handle read before another settle committed changes nothing.
            if (locked === undefined || locked.settledLookupId !== null) {
                return 0;
            }

            const moved = await tx
                .update(ingredients)
                .set({ foodLookupId: bound.lookupId })
                .where(eq(ingredients.foodLookupId, handle.lookupId))
                .returning({ id: ingredients.id });

            await tx
                .update(unresolvedFoods)
                .set({ settledLookupId: bound.lookupId })
                .where(eq(unresolvedFoods.id, handle.unresolvedFoodId));

            return moved.length;
        });
    }

    /**
     * Delete an unresolved binding and its failure record, but only when no line references the binding (R14).
     * Both foreign keys are `RESTRICT`, so an unconditional delete would raise the moment a line still pointed
     * here; a concurrent save that references it first makes this answer `false` rather than fail.
     *
     * @param lookupId - The binding a rebind just left.
     * @returns Whether the binding and its record were deleted.
     * @sideEffect One transaction with at most two deletes.
     */
    public async deleteIfOrphanedFailure(lookupId: string): Promise<boolean> {
        try {
            return await this.db.transaction(async (tx) => {
                const [gone] = await tx
                    .delete(foodLookups)
                    .where(
                        and(
                            eq(foodLookups.id, lookupId),
                            isNotNull(foodLookups.unresolvedFoodId),
                            sql`NOT EXISTS (SELECT 1 FROM ingredients i WHERE i.food_lookup_id = ${foodLookups.id})`,
                        ),
                    )
                    .returning({ unresolvedFoodId: foodLookups.unresolvedFoodId });

                if (gone?.unresolvedFoodId === undefined || gone.unresolvedFoodId === null) {
                    return false;
                }

                await tx
                    .delete(unresolvedFoods)
                    .where(
                        and(
                            eq(unresolvedFoods.id, gone.unresolvedFoodId),
                            sql`NOT EXISTS (SELECT 1 FROM food_lookups fl WHERE fl.unresolved_food_id = ${unresolvedFoods.id})`,
                        ),
                    );

                return true;
            });
        } catch (error) {
            if (isReferencedRefusal(error)) {
                return false;
            }

            throw error;
        }
    }

    /**
     * Which of the given foods ANY live recipe still references (plan U18's erasure protocol).
     *
     * @param foodIds - Food ids.
     * @returns The referenced ones.
     * @sideEffect One read over `recipes ← ingredients → food_lookups`.
     */
    public async referencedFoodIdsAmong(foodIds: readonly string[]): Promise<string[]> {
        if (foodIds.length === 0) {
            return [];
        }

        const result = await this.db.execute<{ food_id: string }>(sql`
            SELECT DISTINCT fl.food_id
              FROM recipes r
              JOIN ingredients i ON i.recipe_id = r.id
              JOIN food_lookups fl ON fl.id = i.food_lookup_id
             WHERE fl.food_id = ANY(${sql.param([...foodIds])})
               AND r.deleted_at IS NULL
        `);

        return result.rows.map((row) => row.food_id);
    }

    /**
     * Every LIVE recipe referencing a food, with its owner (plan U18, R22).
     *
     * @param foodId - The food id.
     * @returns One row per referencing recipe.
     * @sideEffect One grouped read.
     */
    public async recipesReferencingFood(foodId: string): Promise<{ recipeId: string; ownerId: string }[]> {
        const result = await this.db.execute<{ recipe_id: string; owner_id: string }>(sql`
            SELECT r.id AS recipe_id, r.owner_id
              FROM recipes r
              JOIN ingredients i ON i.recipe_id = r.id
              JOIN food_lookups fl ON fl.id = i.food_lookup_id
             WHERE fl.food_id = ${foodId}
               AND r.deleted_at IS NULL
             GROUP BY r.id, r.owner_id
        `);

        return result.rows.map((row) => ({ recipeId: row.recipe_id, ownerId: row.owner_id }));
    }

    /**
     * Merge a failure into the record its phrase already converged on, re-reading after a lost race.
     *
     * @param failure - The new attempt's outcome.
     * @returns The converged binding.
     * @sideEffect Reads and conditionally updates the converged failure.
     */
    private async mergeIntoConverged(failure: NewFailure): Promise<UnresolvedArm> {
        for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt += 1) {
            const existing = await this.findConvergedFailure(failure.normalizedKey);

            if (existing === undefined) {
                throw new Error(`failure ${failure.normalizedKey} conflicted on insert but cannot be read`);
            }

            // A settle is final: the phrase's record now names its target, and records no attempt.
            if (existing.failure.settledLookupId !== null) {
                return existing;
            }

            const written = await this.recordAttempt(existing, mergeAttempt(existing.failure, failure));

            if (written !== undefined) {
                return written;
            }
        }

        // Every retry lost to a concurrent attempt. Each of those counted itself, so the record is current;
        // return it as it stands rather than fail the caller's add over a counter.
        const current = await this.findConvergedFailure(failure.normalizedKey);

        if (current === undefined) {
            throw new Error(`failure ${failure.normalizedKey} vanished while merging`);
        }

        return current;
    }
}
