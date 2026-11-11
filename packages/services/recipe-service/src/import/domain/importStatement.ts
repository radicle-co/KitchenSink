/**
 * The per-recipe statement of a bulk import, and the provenance it sets (ADR-0072 §9).
 *
 * DESIGN PATTERN: **Specification / Policy module**, pure and total. It is the sibling of `provenancePolicy.ts`, and the one
 * place that turns a statement into a recipe's label: ADR-0023 lets only a curator declare `imported_public` on
 * `POST /api/v1/recipes`, and this route is its named exception — the cook's own statement sets the label, and the stored
 * statement and citation are what back it. `imported_physical` and `imported_paid` are set the same way and stay
 * undeclarable anywhere else.
 *
 * | Statement                    | `sourceType`        | Stored source fields                       |
 * | ---------------------------- | ------------------- | ------------------------------------------ |
 * | I wrote this                 | `user_created`      | none                                       |
 * | From a public web page + URL | `imported_public`   | `sourceUrl` = the address                  |
 * | From a book + citation       | `imported_physical` | `sourceAttribution` = the citation         |
 * | From a paid site + citation  | `imported_paid`     | `sourceAttribution` = the citation         |
 *
 * The statement is stored as `statement_kind` (`authored` | `source`), a citation and a source kind, and the label is
 * DERIVED when the item is saved, never stored beside it: there is one statement of the fact.
 */
import { RecipeSourceType } from '@kitchensink/recipe-core';

import type { ResolvedProvenance } from '../../recipes/domain/provenancePolicy.js';
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

/**
 * The provenance a statement sets.
 *
 * @param statement - The cook's statement.
 * @returns The recipe's `sourceType` and its source fields. Pure and total.
 */
export function provenanceOfStatement(statement: KnownImportStatement): ResolvedProvenance {
    switch (statement.kind) {
        case 'authored':
            return { sourceType: RecipeSourceType.USER_CREATED, sourceUrl: null, sourceAttribution: null };
        case 'public_web':
            return {
                sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                sourceUrl: statement.citation,
                sourceAttribution: null,
            };
        case 'book':
            return {
                sourceType: RecipeSourceType.IMPORTED_PHYSICAL,
                sourceUrl: null,
                sourceAttribution: statement.citation,
            };
        case 'paid_site':
            return {
                sourceType: RecipeSourceType.IMPORTED_PAID,
                sourceUrl: null,
                sourceAttribution: statement.citation,
            };
    }
}
