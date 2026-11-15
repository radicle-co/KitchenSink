/**
 * `ownedImport` — the caller's import, or `IMPORT_NOT_FOUND`.
 *
 * ONE statement of the rule every route of the import follows (ADR-0072): an import is read and written only by its owner, and
 * a stranger's id is answered exactly as an absent one is (`404`, never `403`), so the answer does not confirm that the id
 * exists. Three services used to carry this as a private copy.
 */
import type { Principal } from '../auth/principal.js';
import { importNotFound } from '../recipes/recipe.error.js';
import type { ImportHeader, RecipeImportsDal } from './dal/recipeImports.dal.js';

/**
 * Load the caller's import.
 *
 * @param imports - The imports repository (only the header read is used).
 * @param principal - The verified caller.
 * @param importId - The import id from the request.
 * @returns The header.
 * @throws `IMPORT_NOT_FOUND` for a stranger's or an absent import. @sideEffect Reads.
 */
export async function ownedImport(
    imports: Pick<RecipeImportsDal, 'findHeader'>,
    principal: Principal,
    importId: string,
): Promise<ImportHeader> {
    const header = await imports.findHeader(principal.userId, importId);

    if (header === undefined) {
        throw importNotFound(importId);
    }

    return header;
}
