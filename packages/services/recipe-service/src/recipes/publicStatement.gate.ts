/**
 * The public-statement gate: the ONE place a write is judged for the state it leaves, and the ONE place the records of that
 * write are appended (ADR-0095).
 *
 * DESIGN PATTERN: **Facade over the two append-only tables** (`recipe_source_evidence`, `recipe_statement_attestations`) with a
 * **Specification** order in front of them. Create, update and set-visibility used to carry three copies of the same
 * assembly (read the evidence, ask the evidence rule, ask the statement rule, judge the state, ask the confirmation) and could
 * differ by one line. They now state the facts of their write, and this class asks the questions in the policies' order, so
 * the order is one fact held in one place:
 *
 * containment, private-only, the evidence rule (`sourceConflict`), "from another person" (`fromPerson`), the statement rule
 * (`statementRequired`), the publish floor the caller passes in, then the Public confirmation.
 *
 * The rules themselves stay pure and where they were (`evaluatePublishedState`, `publicConfirmationDutyOf`,
 * `sourceConflictOfEvidence`, `statementRequiredOfEvidence`); this class holds no rule of its own, only the order and the I/O.
 *
 * @pattern Facade — one gate over the evidence and attestation tables
 */
import { Inject, Injectable } from '@nestjs/common';
import {
    fromPersonOf,
    type RecipeSourceKind,
    type RecipeSourceType,
    type RecipeStatementKind,
} from '@kitchensink/recipe-core';

import type { Principal } from '../auth/principal.js';
import type { RecipeTx } from '../database/unitOfWork.js';
import { RecipeSourceEvidenceDal } from './dal/recipeSourceEvidence.dal.js';
import { RecipeStatementAttestationsDal } from './dal/recipeStatementAttestations.dal.js';
import {
    sourceConflictOfEvidence,
    statementRequiredOfEvidence,
    type EvidenceToWrite,
} from './domain/sourceEvidence.js';
import {
    attestationRowsOf,
    isApiWriterConfirmation,
    publicConfirmationDutyOf,
    type PublishedFacts,
} from './domain/statementAttestation.js';
import { evaluatePublishedState } from './domain/visibilityPolicy.js';
import { testPrincipalContained } from '../common/containment.error.js';
import { apiWriterConfirmationForbidden, policyRefusal, publicConfirmationRequired } from './recipe.error.js';
import type { PublicConfirmationInput, RecipeStatementInput } from './recipes.schema.js';
import type { AttestationAction } from '../database/schema/index.js';

/** The state a write leaves, and everything the rules read about it. Every member is REQUIRED except the three marked. */
export interface PublicWrite {
    /** The verified caller, for containment. */
    readonly principal: Principal;
    /**
     * The stored recipe and the write's open transaction, so the evidence is read under the write's own row lock. Absent for a
     * create: a new recipe has no stored evidence.
     */
    readonly stored?: { readonly tx: RecipeTx; readonly recipeId: string };
    /** The recipe as stored, or `undefined` for a create. */
    readonly before: PublishedFacts | undefined;
    /** The status and visibility the write LEAVES. */
    readonly after: PublishedFacts;
    /** The label and kind the write LEAVES. */
    readonly source: { readonly sourceType: RecipeSourceType; readonly sourceKind: RecipeSourceKind | null };
    /** What the cook stated AFTER the write: the correction's, else the stored one. */
    readonly statementKind: RecipeStatementKind | null;
    /** When content was first reported pasted, as the write leaves it. */
    readonly contentPastedAt: Date | string | null | undefined;
    /** The evidence rows this write is about to append. */
    readonly pending: readonly EvidenceToWrite[];
    /** The request's confirmation, if it sent one. */
    readonly confirmation: PublicConfirmationInput | undefined;
    /** The write carries an explicit "I wrote this" that took effect: its own attestation row answers for the confirmation. */
    readonly authoredInWrite: boolean;
    /** A check the caller makes AFTER the state rules and BEFORE the confirmation (the publish floor), so its order is kept. */
    readonly afterState?: () => void;
}

/** What the judgement learned, for the caller's own checks that need it (the C-004 ask) and for the records it writes. */
export interface PublicVerdict {
    /** Whether the evidence holds the recipe out of Public (`sourceConflictOf`). */
    readonly sourceConflict: boolean;
    /** Whether the cook said the recipe is another person's (`fromPersonOf`). */
    readonly fromPerson: boolean;
    /** Whether the cook still owes a statement (`statementRequiredOf`). */
    readonly statementRequired: boolean;
    /** Whether the write records the confirmation it was sent. */
    readonly recordsConfirmation: boolean;
}

/** The records a landed write leaves. */
export interface PublicRecords {
    readonly recipeId: string;
    /** The acting owner (`recipes.owner_id` at the time). */
    readonly accountId: string;
    readonly action: AttestationAction;
    /** The evidence rows the write appended. */
    readonly evidence: readonly EvidenceToWrite[];
    /** The statement that TOOK EFFECT: `undefined` when the request carried none or it changed nothing. */
    readonly statement: RecipeStatementInput | null | undefined;
    readonly publicConfirmation: PublicConfirmationInput | undefined;
    /** {@link PublicVerdict.recordsConfirmation}. */
    readonly recordsConfirmation: boolean;
}

@Injectable()
export class PublicStatementGate {
    public constructor(
        @Inject(RecipeSourceEvidenceDal)
        private readonly evidence: Pick<RecipeSourceEvidenceDal, 'insert' | 'list'>,
        @Inject(RecipeStatementAttestationsDal)
        private readonly attestations: Pick<RecipeStatementAttestationsDal, 'insertMany' | 'hasFromPerson'>,
    ) {}

    /**
     * Judge the state a write leaves, and throw its refusal.
     *
     * @param write - The state the write leaves and the facts the rules read.
     * @returns What was learned, for the caller's C-004 ask and for {@link record}.
     * @throws {HttpException} `TEST_PRINCIPAL_CONTAINED` for a contained principal.
     * @throws {RecipeDomainError} `INVALID_VISIBILITY` with the refusing rule's `details.reason`.
     * @sideEffect One read of `recipe_source_evidence` and one of `recipe_statement_attestations` for a stored recipe.
     */
    public async judge(write: PublicWrite): Promise<PublicVerdict> {
        const details = { visibility: write.after.visibility, sourceType: write.source.sourceType };
        const marker = isApiWriterConfirmation(write.confirmation);

        // ⛔ FIRST, before any state rule: the marker says no one was shown the line, so only a test principal may send it, whether
        // or not this write needed a confirmation.
        if (marker && write.principal.principalKind !== 'test') {
            throw apiWriterConfirmationForbidden(details);
        }

        const stored =
            write.stored === undefined ? [] : await this.evidence.list(write.stored.recipeId, write.stored.tx);
        const evidence = [...stored, ...write.pending];
        const sourceConflict = sourceConflictOfEvidence(evidence, write.source);
        const statementRequired = statementRequiredOfEvidence(evidence, {
            sourceType: write.source.sourceType,
            statementKind: write.statementKind,
            contentPastedAt: write.contentPastedAt,
        });
        const fromPerson =
            write.stored === undefined
                ? fromPersonOf({ statementKind: write.statementKind, attestedFromPerson: false })
                : await this.fromPersonHeld(write.stored.tx, write.stored.recipeId, write.statementKind);
        const decision = evaluatePublishedState({
            ...write.after,
            ...write.source,
            sourceConflict,
            fromPerson,
            statementRequired,
            principalKind: write.principal.principalKind,
            containment: write.principal.containment,
        });

        if (!decision.allowed) {
            throw decision.denial === 'contained'
                ? testPrincipalContained(decision.reason)
                : policyRefusal(decision.denial, decision.reason, details);
        }

        write.afterState?.();

        const duty = publicConfirmationDutyOf({
            before: write.before,
            after: write.after,
            authoredInWrite: write.authoredInWrite,
        });

        if (duty.required && write.confirmation === undefined) {
            throw publicConfirmationRequired(details);
        }

        return {
            sourceConflict,
            fromPerson,
            statementRequired,
            recordsConfirmation: !marker && duty.recordedWhenSupplied,
        };
    }

    /**
     * Append the records a write leaves, in the write's OWN transaction.
     *
     * ⛔ Called only after the write LANDED (the version check and the compare-and-swap have passed), so a refused write, a lost
     * race and a rolled-back transaction all leave no row. The evidence goes first: a stated source with no evidence row
     * cannot commit (migration 0086).
     *
     * @param tx - The write's open transaction.
     * @param records - What the write appended.
     * @sideEffect Inserts into `recipe_source_evidence` and `recipe_statement_attestations`; nothing for a write that left none.
     */
    public async record(tx: RecipeTx, records: PublicRecords): Promise<void> {
        for (const row of records.evidence) {
            await this.evidence.insert(tx, { ...row, recipeId: records.recipeId });
        }

        const rows = attestationRowsOf({
            action: records.action,
            statement: records.statement,
            publicConfirmation: records.publicConfirmation,
            recordsConfirmation: records.recordsConfirmation,
        });

        // The ONE empty-list guard: a write that states and confirms nothing leaves no row and costs no statement.
        if (rows.length > 0) {
            await this.attestations.insertMany(
                tx,
                rows.map((row) => ({ ...row, recipeId: records.recipeId, accountId: records.accountId })),
            );
        }
    }

    /**
     * Whether a stored recipe is another person's (`fromPersonOf`): its statement says so, or it has none and the cook once
     * attested it. Read in the caller's transaction.
     *
     * @param tx - The open transaction.
     * @param recipeId - The stored recipe.
     * @param statementKind - The statement the recipe will hold after the write.
     * @returns `true` when Public must be refused.
     * @sideEffect Reads `recipe_statement_attestations`, and only when no statement is stored (the answer needs it then).
     */
    public async fromPersonHeld(
        tx: RecipeTx,
        recipeId: string,
        statementKind: RecipeStatementKind | null,
    ): Promise<boolean> {
        const attestedFromPerson = statementKind === null && (await this.attestations.hasFromPerson(tx, recipeId));

        return fromPersonOf({ statementKind, attestedFromPerson });
    }

    /**
     * Whether the evidence of a stored recipe holds it out of Public, read in the caller's transaction. For a clone, whose
     * default visibility is judged on the evidence it inherits.
     *
     * @param tx - The open transaction.
     * @param recipeId - The recipe whose evidence is read.
     * @param recipe - Its label and kind.
     * @returns `true` when Public must be refused.
     * @sideEffect Reads `recipe_source_evidence`.
     */
    public async holdsOutOfPublic(
        tx: RecipeTx,
        recipeId: string,
        recipe: { readonly sourceType: RecipeSourceType; readonly sourceKind: RecipeSourceKind | null },
    ): Promise<boolean> {
        return sourceConflictOfEvidence(await this.evidence.list(recipeId, tx), recipe);
    }
}
