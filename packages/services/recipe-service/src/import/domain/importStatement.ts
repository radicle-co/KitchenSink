/**
 * The per-recipe statement of a bulk import, as its columns store it (ADR-0072 §9).
 *
 * DESIGN PATTERN: **Data Mapper** between a statement and the three columns that store it, pure and total. The provenance a
 * statement SETS is not read here: `resolveStatementProvenance` (`recipes/domain/provenancePolicy.ts`) is the one reading of
 * a statement, for a recipe's own `statement` and for the import alike (ADR-0089), so the two cannot disagree about a label
 * or its kind.
 *
 * The statement is stored as `statement_kind` (`authored` | `source`), a citation and a source kind, and the label is
 * DERIVED when the item is saved, never stored beside it: there is one statement of the fact.
 */
import type { ImportStatement, ImportStatementView } from '../../recipes/import.schema.js';
import {
    IMPORT_SOURCE_KINDS,
    type ImportSourceKind,
    type ImportStatementKind,
} from '../../database/schema/recipeImports.js';

/**
 * A statement this build KNOWS: a request's, or a response's other than `unrecognised`. The server only ever stores and reads
 * the four kinds its CHECKs admit; `unrecognised` is the installed client's reading of a newer server's kind.
 */
export type KnownImportStatement = ImportStatement | Exclude<ImportStatementView, { kind: 'unrecognised' }>;

/** The three columns that hold a statement. */
export interface StatementColumns {
    readonly statementKind: ImportStatementKind;
    readonly citation: string | null;
    readonly sourceKind: ImportSourceKind | null;
}

/** The same columns as a row reads them, before they are narrowed. */
export interface StoredStatementColumns {
    readonly statementKind: string | null;
    readonly citation: string | null;
    readonly sourceKind: string | null;
}

/**
 * The columns a statement is stored in.
 *
 * @param statement - A request's statement.
 * @returns The three columns. Pure and total.
 */
export function columnsOfStatement(statement: KnownImportStatement): StatementColumns {
    if (statement.kind === 'authored') {
        return { statementKind: 'authored', citation: null, sourceKind: null };
    }

    return { statementKind: 'source', citation: statement.citation, sourceKind: statement.kind };
}

/**
 * The statement stored in these columns.
 *
 * @param columns - The row's columns.
 * @returns The statement, or `undefined` when the cook has not said yet.
 * @throws {Error} on columns the table's CHECKs refuse: a stored statement this build cannot read is a defect, and
 *   inventing a label from it would put a false attribution on a recipe.
 */
export function statementOfColumns(columns: StoredStatementColumns): KnownImportStatement | undefined {
    const { statementKind, citation, sourceKind } = columns;

    if (statementKind === null) {
        if (citation !== null || sourceKind !== null) {
            throw new Error('an import item holds a citation but no statement');
        }

        return undefined;
    }

    if (statementKind === 'authored') {
        if (citation !== null || sourceKind !== null) {
            throw new Error('an import item says "I wrote this" and also holds a citation');
        }

        return { kind: 'authored' };
    }

    if (statementKind === 'source') {
        const kind = IMPORT_SOURCE_KINDS.find((candidate) => candidate === sourceKind);

        if (citation === null || kind === undefined) {
            throw new Error('an import item cites a source without a citation or a source kind');
        }

        return { kind, citation };
    }

    throw new Error(`an import item holds an unknown statement kind: ${statementKind}`);
}
