/**
 * The `recipe_statement_attestations` DAL (migrations 0088 and 0090): INSERT, and the one read the rules need. The table is
 * append-only in the database itself (a trigger refuses DELETE for every role and UPDATE bar the two it names), so no method
 * here could change a row if it tried. The one read is whether the cook ever attested "from another person" (`fromPersonOf`),
 * the fact that survives a cleared statement. A row is otherwise read by a person (support), there.
 *
 * Every method takes the CALLER'S transaction and has no default executor: a row commits or rolls back with the write it
 * records, so a refused or rolled-back write leaves none.
 *
 * @pattern Repository — append-only
 * @sideEffect Every method writes Postgres through the transaction it is given.
 */
import { and, eq } from 'drizzle-orm';

import { recipeStatementAttestations } from '../../database/schema/index.js';
import type { NewRecipeStatementAttestationRow } from '../../database/schema/recipeStatementAttestations.js';
import type { RecipeTx } from '../../database/unitOfWork.js';

/** A row to append: the recipe it records is named once, and the service keeps `recipe_ref` equal to it. */
export type AttestationToInsert = Omit<NewRecipeStatementAttestationRow, 'recipeId' | 'recipeRef'> & {
    readonly recipeId: string;
};

export class RecipeStatementAttestationsDal {
    /**
     * Append the rows one write leaves (none, one or two), in order.
     *
     * @param tx - The write's open transaction.
     * @param rows - The rows, with their recipe and account. At least one: the caller (`PublicStatementGate.record`) holds the one
     *   empty-list guard, because an empty `INSERT … VALUES` is a statement the database refuses.
     * @sideEffect Inserts into `recipe_statement_attestations`.
     */
    public async insertMany(tx: RecipeTx, rows: readonly AttestationToInsert[]): Promise<void> {
        await tx.insert(recipeStatementAttestations).values(rows.map((row) => ({ ...row, recipeRef: row.recipeId })));
    }

    /**
     * Whether the cook ever attested "from another person" for this recipe, whatever they said after.
     *
     * @param tx - The caller's transaction, so the answer is read under the write's own row lock.
     * @param recipeId - The stored recipe.
     * @returns `true` when any `fromPerson` row exists.
     * @sideEffect Reads `recipe_statement_attestations`.
     */
    public async hasFromPerson(tx: RecipeTx, recipeId: string): Promise<boolean> {
        const rows = await tx
            .select({ id: recipeStatementAttestations.id })
            .from(recipeStatementAttestations)
            .where(
                and(
                    eq(recipeStatementAttestations.recipeId, recipeId),
                    eq(recipeStatementAttestations.choice, 'fromPerson'),
                ),
            )
            .limit(1);

        return rows.length > 0;
    }
}
