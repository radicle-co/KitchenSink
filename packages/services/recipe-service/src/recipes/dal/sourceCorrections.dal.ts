/**
 * The writes of a staff source correction (ADR-0099, plan everyAnswerSourceLock U3), every one inside the caller's transaction.
 *
 * @pattern Repository — over `recipes` and `recipe_source_corrections`, taking the CALLER'S transaction so the rewrite, its record
 *   and the held clones are one unit that commits or rolls back together.
 *
 * ## The rules that live here
 *
 *  1. **Private and held are written, never public.** The rewrite sets `visibility = 'private'` in the same UPDATE as the new
 *     answer. The hold is only ever turned ON (the database ratchet refuses the reverse), and a correction that needs none leaves
 *     the column as it was.
 *  2. **No version bump and no snapshot.** A correction is a metadata change by staff, not a revision by the cook.
 *  3. **The clone walk follows EVERY `cloned_from_id` descendant and updates only the owner's.** A clone of another cook's clone of
 *     this recipe is still held, because it descends from the corrected text; but another cook's own copy is theirs and is not
 *     touched. `UNION` (not `UNION ALL`) ends the walk on a cycle.
 *  4. **The confirmation is set once.** `COALESCE(source_confirmed_at, now())`, as the other writers of that column do.
 *
 * @sideEffect Every method reads or writes Postgres through the transaction it is given.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { ResolvedProvenance } from '../domain/provenancePolicy.js';
import type { CorrectableRecipe } from '../domain/sourceCorrectionScopePolicy.js';
import { recipeSourceCorrections, recipes } from '../../database/schema/index.js';
import type { RecipeTx } from '../../database/unitOfWork.js';
import { activeRecipe } from './recipePredicates.js';

/** What `recordCorrection` stores. */
export interface CorrectionRecord {
    readonly recipeId: string;
    readonly actorAccountId: string;
    readonly before: CorrectableRecipe;
    readonly after: ResolvedProvenance;
    readonly ground: (typeof recipeSourceCorrections.$inferInsert)['ground'];
    readonly reason: string;
}

export class SourceCorrectionsDal {
    /**
     * The recipe's owner and source facts, read `FOR UPDATE`. The caller already holds the owner's private-slot lock, so the order
     * is owner lock, then recipe row (ADR-0073).
     *
     * @param tx - The open transaction.
     * @param id - The recipe.
     * @returns The facts, or `undefined` when no active recipe has that id.
     * @sideEffect Row-locks the `recipes` row until the transaction ends.
     */
    public async lockRecipe(tx: RecipeTx, id: string): Promise<CorrectableRecipe | undefined> {
        const [row] = await tx
            .select({
                ownerId: recipes.ownerId,
                sourceType: recipes.sourceType,
                sourceKind: recipes.sourceKind,
                statementKind: recipes.statementKind,
                sourceUrl: recipes.sourceUrl,
                sourceAttribution: recipes.sourceAttribution,
            })
            .from(recipes)
            .where(and(eq(recipes.id, id), activeRecipe()))
            .for('update');

        return row;
    }

    /**
     * Write the new answer: the five source columns together, private, confirmed, and held when the policy says so.
     *
     * @param tx - The open transaction.
     * @param input.recipeId - The recipe.
     * @param input.provenance - The answer to write.
     * @param input.hold - Whether to hold the recipe off Public. `false` leaves the column as it is: a hold is never lifted.
     * @sideEffect Updates the `recipes` row; does not touch `current_version`.
     */
    public async rewriteSource(
        tx: RecipeTx,
        input: { readonly recipeId: string; readonly provenance: ResolvedProvenance; readonly hold: boolean },
    ): Promise<void> {
        const { recipeId, provenance, hold } = input;

        await tx
            .update(recipes)
            .set({
                sourceType: provenance.sourceType,
                sourceKind: provenance.sourceKind,
                statementKind: provenance.statementKind,
                sourceUrl: provenance.sourceUrl,
                sourceAttribution: provenance.sourceAttribution,
                sourceConfirmedAt: sql`COALESCE(${recipes.sourceConfirmedAt}, now())`,
                visibility: 'private',
                ...(hold ? { sourceCorrectionHold: true } : {}),
                updatedAt: new Date(),
            })
            .where(and(eq(recipes.id, recipeId), activeRecipe()));
    }

    /**
     * Append the audit record of one correction.
     *
     * @param tx - The open transaction.
     * @param record - The recipe, the actor, the old and new answer, the ground and the reason.
     * @sideEffect Inserts into `recipe_source_corrections`.
     */
    public async recordCorrection(tx: RecipeTx, record: CorrectionRecord): Promise<void> {
        const { before, after } = record;

        await tx.insert(recipeSourceCorrections).values({
            recipeId: record.recipeId,
            actorAccountId: record.actorAccountId,
            oldSourceType: before.sourceType,
            newSourceType: after.sourceType,
            oldSourceKind: before.sourceKind,
            newSourceKind: after.sourceKind,
            oldStatementKind: before.statementKind,
            newStatementKind: after.statementKind,
            oldSourceUrl: before.sourceUrl,
            newSourceUrl: after.sourceUrl,
            oldSourceAttribution: before.sourceAttribution,
            newSourceAttribution: after.sourceAttribution,
            ground: record.ground,
            reason: record.reason,
        });
    }

    /**
     * Make every clone the owner holds of this recipe, at any depth, private and held (AE26). The walk goes through other cooks'
     * clones, because a clone of their clone descends from the corrected text; it UPDATES only the owner's rows. These rows take no
     * slot check: a hold is never refused for a full slot count, and the owner's next private save meets the limit as it always does.
     *
     * @param tx - The open transaction.
     * @param recipeId - The corrected recipe.
     * @param ownerId - Its owner.
     * @sideEffect Updates the owner's descendant `recipes` rows.
     */
    public async holdOwnersClones(tx: RecipeTx, recipeId: string, ownerId: string): Promise<void> {
        await tx.execute(sql`
            WITH RECURSIVE descendants(id) AS (
                SELECT ${recipes.id} FROM ${recipes} WHERE ${recipes.clonedFromId} = ${recipeId}::uuid
                UNION
                SELECT r.id FROM ${recipes} r JOIN descendants d ON r.cloned_from_id = d.id
            )
            UPDATE ${recipes}
               SET visibility = 'private', source_correction_hold = true, updated_at = now()
             WHERE ${recipes.id} IN (SELECT id FROM descendants)
               AND ${recipes.ownerId} = ${ownerId}
               AND ${recipes.deletedAt} IS NULL
        `);
    }
}
