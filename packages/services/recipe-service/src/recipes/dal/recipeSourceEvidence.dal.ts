/**
 * The `recipe_source_evidence` DAL (migration 0086): INSERT and READ, nothing else. The table is append-only in the database
 * itself (a trigger refuses UPDATE and DELETE for every role), so no method here could change a row if it tried.
 *
 * `insert` takes the CALLER'S transaction and has no default executor: the evidence row commits or rolls back with the
 * statement it records. `list` takes one too wherever a write decides from it.
 *
 * @pattern Repository — append-only
 * @sideEffect Every method reads or writes Postgres through the transaction it is given.
 */
import { eq } from 'drizzle-orm';

import { recipeSourceEvidence } from '../../database/schema/index.js';
import type {
    NewRecipeSourceEvidenceRow,
    RecipeSourceEvidenceRow,
} from '../../database/schema/recipeSourceEvidence.js';
import type { RecipeDrizzle } from '../../database/client.js';
import type { RecipeTx } from '../../database/unitOfWork.js';

export class RecipeSourceEvidenceDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Append one evidence row.
     *
     * @param tx - The write's open transaction.
     * @param row - The row, with its recipe.
     * @sideEffect Inserts into `recipe_source_evidence`.
     */
    public async insert(tx: RecipeTx, row: NewRecipeSourceEvidenceRow): Promise<void> {
        await tx.insert(recipeSourceEvidence).values(row);
    }

    /**
     * Every evidence row of a recipe, oldest first.
     *
     * A WRITE passes its own open transaction, so the evidence it judges Public against is read under that write's row lock.
     * A READ that decides nothing (the owner-only `publicNeeds*` hints on a detail response) passes none and reads committed
     * rows. ⛔ Never decide a write from a read made without its transaction.
     *
     * @param recipeId - The recipe.
     * @param tx - The write's open transaction; absent for a committed read.
     * @returns The rows, possibly none.
     * @sideEffect Reads `recipe_source_evidence`.
     */
    public async list(recipeId: string, tx?: RecipeTx): Promise<RecipeSourceEvidenceRow[]> {
        return (tx ?? this.db)
            .select()
            .from(recipeSourceEvidence)
            .where(eq(recipeSourceEvidence.recipeId, recipeId))
            .orderBy(recipeSourceEvidence.recordedAt);
    }
}
