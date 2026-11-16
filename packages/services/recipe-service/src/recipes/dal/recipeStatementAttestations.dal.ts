/**
 * The `recipe_statement_attestations` DAL (migration 0088): INSERT, nothing else. The table is append-only in the database
 * itself (a trigger refuses UPDATE and DELETE for every role, bar the erasure swap of account_id), so no method here could change a row if it tried, and there is
 * no read: nothing in the service decides from an attestation. A row is read by a person (support), there.
 *
 * Every method takes the CALLER'S transaction and has no default executor: a row commits or rolls back with the write it
 * records, so a refused or rolled-back write leaves none.
 *
 * @pattern Repository — append-only
 * @sideEffect Every method writes Postgres through the transaction it is given.
 */
import { recipeStatementAttestations } from '../../database/schema/index.js';
import type { NewRecipeStatementAttestationRow } from '../../database/schema/recipeStatementAttestations.js';
import type { RecipeTx } from '../../database/unitOfWork.js';

export class RecipeStatementAttestationsDal {
    /**
     * Append the rows one write leaves (none, one or two), in order.
     *
     * @param tx - The write's open transaction.
     * @param rows - The rows, with their recipe and account. At least one: the caller (`PublicStatementGate.record`) holds the one
     *   empty-list guard, because an empty `INSERT … VALUES` is a statement the database refuses.
     * @sideEffect Inserts into `recipe_statement_attestations`.
     */
    public async insertMany(tx: RecipeTx, rows: readonly NewRecipeStatementAttestationRow[]): Promise<void> {
        await tx.insert(recipeStatementAttestations).values([...rows]);
    }
}
