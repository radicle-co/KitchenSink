/**
 * The pure attestation rules: WHEN a write must carry the passive Public confirmation, and WHICH rows a write leaves in
 * `recipe_statement_attestations` (migration 0088).
 *
 * DESIGN PATTERN: **Specification + Mapper**, the sibling of `evidenceRowOf`. {@link publicConfirmationDutyOf} is one pure
 * question over the state a write leaves, asked by create, update and set-visibility so they cannot disagree about it;
 * {@link attestationRowsOf} is the ONE place a request's statement and confirmation become rows. No database, no principal.
 *
 * ## The two acts, and why they are separate
 *
 * - An EXPLICIT row is the cook's own act on a choice: a statement (`authored`, `publicWeb`, `book`, `fromPerson`) or its
 *   removal (`cleared`, no wording because nothing was shown). Written whenever the request carries a `statement`.
 * - An IMPLICIT row is the line shown beside Public (`publicConfirm`). It is REQUIRED when the write makes a recipe
 *   published AND public, and RECORDED whenever the cook chose Public in a write that was sent one.
 *
 * ⛔ The two rules are not the statement rule (`statementRequiredOf`) and not the evidence rule (`sourceConflictOf`): those
 * decide whether a recipe may be public at all; this decides only whether the cook was SHOWN the confirmation. Each is asked
 * in its own place and none is folded into another.
 *
 * @pattern Specification — one pure predicate, one row mapper
 */
import type { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import type { AttestationAction, NewRecipeStatementAttestationRow } from '../../database/schema/index.js';
import type { PublicConfirmationInput, RecipeStatementInput } from '../recipes.schema.js';

/** The status and visibility of a recipe, before or after a write. */
export interface PublishedFacts {
    readonly status: RecipeStatus;
    readonly visibility: RecipeVisibility;
}

/** What a write owes the passive confirmation. */
export interface PublicConfirmationDuty {
    /**
     * The write makes the recipe published and public where it was not, and says no "I wrote this" of its own: it must carry
     * the confirmation. An explicit `authored` statement in the same write is the stronger act, so it answers for it.
     */
    readonly required: boolean;
    /** The cook chose Public in this write: a confirmation they sent is recorded. (Always true when `required`.) */
    readonly recordedWhenSupplied: boolean;
}

/**
 * Whether a write owes the Public confirmation, and whether one it carries is recorded.
 *
 * `required` is "BECOMES published and public": the state after is published and public and the state before was not. A save
 * of a recipe already published and public needs none, because nothing changes. A move to Public of a DRAFT is not required
 * (nothing is live) but is recorded when sent: it is the cook choosing Public, which the confirmation sits beside.
 *
 * @param input.before - The recipe as stored, or `undefined` for a create.
 * @param input.after - The status and visibility the write LEAVES.
 * @param input.authoredInWrite - The write carries an explicit "I wrote this" that TOOK EFFECT (its own attestation row is
 *   written), so no separate confirmation is owed. A confirmation it was sent is still recorded.
 * @returns The duty. Pure.
 */
export function publicConfirmationDutyOf(input: {
    readonly before: PublishedFacts | undefined;
    readonly after: PublishedFacts;
    readonly authoredInWrite: boolean;
}): PublicConfirmationDuty {
    const { before, after, authoredInWrite } = input;
    const isPublic = after.visibility === 'public';
    const wasPublic = before?.visibility === 'public';
    const isLive = after.status === 'published' && isPublic;
    const wasLive = before?.status === 'published' && wasPublic;
    const becomesLive = isLive && !wasLive;

    return { required: becomesLive && !authoredInWrite, recordedWhenSupplied: becomesLive || (isPublic && !wasPublic) };
}

/** One row before it is given its recipe and account. */
export type AttestationToWrite = Pick<
    NewRecipeStatementAttestationRow,
    'mode' | 'choice' | 'wordingVersion' | 'locale' | 'action'
>;

/** The attestation choice of each statement kind a request can carry. */
const CHOICE_OF_KIND = {
    authored: 'authored',
    public_web: 'publicWeb',
    book: 'book',
    fromPerson: 'fromPerson',
} as const satisfies Record<RecipeStatementInput['kind'], NewRecipeStatementAttestationRow['choice']>;

/**
 * The rows one write leaves, in order: the statement's, then the confirmation's.
 *
 * @param input.action - The write the rows ride on.
 * @param input.statement - The request's statement: `undefined` (none said), `null` (removed) or a statement.
 * @param input.publicConfirmation - The request's confirmation, if it sent one.
 * @param input.recordsConfirmation - Whether the duty records a confirmation the request sent
 *   ({@link PublicConfirmationDuty.recordedWhenSupplied}).
 * @returns Zero, one or two rows. Pure.
 */
export function attestationRowsOf(input: {
    readonly action: AttestationAction;
    readonly statement: RecipeStatementInput | null | undefined;
    readonly publicConfirmation: PublicConfirmationInput | undefined;
    readonly recordsConfirmation: boolean;
}): AttestationToWrite[] {
    const { action, statement, publicConfirmation, recordsConfirmation } = input;
    const rows: AttestationToWrite[] = [];

    if (statement === null) {
        rows.push({ mode: 'explicit', choice: 'cleared', wordingVersion: null, locale: null, action });
    } else if (statement !== undefined && statement.wording !== undefined) {
        // A statement with no wording (the Source row's link) states a source and records no attestation: nothing was shown.
        rows.push({
            mode: 'explicit',
            choice: CHOICE_OF_KIND[statement.kind],
            wordingVersion: statement.wording.version,
            locale: statement.wording.locale,
            action,
        });
    }

    if (publicConfirmation !== undefined && recordsConfirmation) {
        rows.push({
            mode: 'implicit',
            choice: 'publicConfirm',
            wordingVersion: publicConfirmation.version,
            locale: publicConfirmation.locale,
            action,
        });
    }

    return rows;
}
