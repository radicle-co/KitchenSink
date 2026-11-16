/**
 * The public-statement gate over fake evidence and attestation tables: the ORDER of refusals a write is judged in, and the rows
 * it leaves. One gate answers for create, update and set-visibility, so one matrix proves them all.
 *
 * Each row below is a mutant a weaker suite would let live: a gate that asked the rules in another order, read no stored
 * evidence, forgot the pending row, asked for the confirmation of a write that does not publish, wrote rows before the
 * evidence, or touched the table for an empty list fails at least one row.
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RecipeSourceType, type RecipeStatus, type RecipeVisibility } from '@kitchensink/recipe-core';

import type { Principal } from '../../auth/principal.js';
import { FAKE_TX } from '../__fixtures__/recipesDal.fixture.js';
import type { RecipeSourceEvidenceDal } from '../dal/recipeSourceEvidence.dal.js';
import type { RecipeStatementAttestationsDal } from '../dal/recipeStatementAttestations.dal.js';
import type { EvidenceToWrite } from '../domain/sourceEvidence.js';
import { PublicStatementGate, type PublicWrite } from '../publicStatement.gate.js';

const CONFIRM = { version: 'publicConfirm.v1', locale: 'en' } as const;
const WEB_ROW: EvidenceToWrite = {
    capture: 'editorLink',
    sourceUrl: 'https://www.allrecipes.com/recipe/1/soup/',
    sourceKey: 'https://www.allrecipes.com/recipe/1/soup/',
    sourceDomain: 'allrecipes.com',
    sourceKind: 'public_web',
};
const REAL: Principal = {
    userId: 'u1',
    sub: 's1',
    scopes: [],
    permissions: [],
    roles: [],
    principalKind: 'real',
    containment: 'enforce',
};
const TEST_COOK: Principal = { ...REAL, principalKind: 'test' };

function gateOf(stored: readonly EvidenceToWrite[] = []) {
    const insert = vi.fn(async () => undefined);
    const list = vi.fn(async () => stored.map((row, index) => ({ ...row, id: `e${String(index)}` })));
    const insertMany = vi.fn(async () => undefined);
    const gate = new PublicStatementGate(
        { insert, list } as unknown as Pick<RecipeSourceEvidenceDal, 'insert' | 'list'>,
        { insertMany } as unknown as Pick<RecipeStatementAttestationsDal, 'insertMany'>,
    );

    return { gate, insert, list, insertMany };
}

/** A write that leaves a published, public recipe the cook wrote and stated nothing about: the base every row bends. */
function writeOf(over: Partial<PublicWrite> = {}): PublicWrite {
    return {
        principal: REAL,
        before: undefined,
        after: { status: 'published' as RecipeStatus, visibility: 'public' as RecipeVisibility },
        source: { sourceType: RecipeSourceType.USER_CREATED, sourceKind: null },
        statementKind: null,
        contentPastedAt: undefined,
        pending: [],
        confirmation: CONFIRM,
        confirmationExempt: false,
        authoredInWrite: false,
        ...over,
    };
}

/** What refused the write: the `details.reason` of a domain error, or the `code` of an HTTP refusal; `ALLOWED` when none. */
async function reasonOf(write: Promise<unknown>): Promise<string> {
    try {
        await write;
    } catch (error) {
        if (error instanceof HttpException) {
            return (error.getResponse() as { code: string }).code;
        }

        return (error as { details?: { reason?: string } }).details?.reason ?? 'OTHER';
    }

    return 'ALLOWED';
}

describe('PublicStatementGate.judge — the order of refusals', () => {
    it('allows a typed recipe with nothing stated and nothing pasted', async () => {
        const { gate } = gateOf();

        await expect(gate.judge(writeOf())).resolves.toMatchObject({
            sourceConflict: false,
            statementRequired: false,
        });
    });

    it('containment answers first, over a private-only label that also holds evidence', async () => {
        const { gate } = gateOf();
        const write = writeOf({
            principal: TEST_COOK,
            source: { sourceType: RecipeSourceType.IMPORTED_PAID, sourceKind: 'paid_site' },
        });

        await expect(reasonOf(gate.judge(write))).resolves.toBe('TEST_PRINCIPAL_CONTAINED');
    });

    it('private-only answers before the evidence rule', async () => {
        const { gate } = gateOf([WEB_ROW]);
        const write = writeOf({ source: { sourceType: RecipeSourceType.IMPORTED_PHYSICAL, sourceKind: 'book' } });

        await expect(reasonOf(gate.judge(write))).resolves.not.toBe('SOURCE_CONFLICT');
    });

    it('the evidence rule answers before the statement rule', async () => {
        const { gate } = gateOf([WEB_ROW]);

        // Stored web evidence, a cook-written label with no statement: BOTH rules hold, and the evidence rule speaks.
        await expect(reasonOf(gate.judge(writeOf({ stored: { tx: FAKE_TX, recipeId: 'r1' } })))).resolves.toBe(
            'SOURCE_CONFLICT',
        );
    });

    it('the stored "from another person" statement answers after the evidence rule and before the statement rule', async () => {
        const evidenced = gateOf([WEB_ROW]);
        const bare = gateOf();
        const person = { statementKind: 'fromPerson' } as const;

        await expect(
            reasonOf(evidenced.gate.judge(writeOf({ ...person, stored: { tx: FAKE_TX, recipeId: 'r1' } }))),
        ).resolves.toBe('SOURCE_CONFLICT');
        await expect(reasonOf(bare.gate.judge(writeOf(person)))).resolves.toBe('FROM_PERSON_PRIVATE_ONLY');
    });

    it('lets a recipe the cook said is another person’s stay Private, and be a draft', async () => {
        const { gate } = gateOf();
        const person = { statementKind: 'fromPerson' } as const;
        const privatePublished = { status: 'published' as RecipeStatus, visibility: 'private' as RecipeVisibility };
        const publicDraft = { status: 'draft' as RecipeStatus, visibility: 'public' as RecipeVisibility };

        await expect(gate.judge(writeOf({ ...person, after: privatePublished }))).resolves.toMatchObject({
            fromPerson: true,
        });
        await expect(
            gate.judge(writeOf({ ...person, after: publicDraft, confirmation: undefined })),
        ).resolves.toMatchObject({
            fromPerson: true,
        });
    });

    it('asks for the statement when only the statement rule holds (a paste was seen)', async () => {
        const { gate } = gateOf();

        await expect(reasonOf(gate.judge(writeOf({ contentPastedAt: new Date() })))).resolves.toBe(
            'STATEMENT_REQUIRED',
        );
    });

    it('reads the stored evidence in the write’s own transaction, and only for a stored recipe', async () => {
        const stored = gateOf([WEB_ROW]);
        const created = gateOf([WEB_ROW]);

        await reasonOf(stored.gate.judge(writeOf({ stored: { tx: FAKE_TX, recipeId: 'r1' } })));
        await reasonOf(created.gate.judge(writeOf()));

        expect(stored.list).toHaveBeenCalledWith('r1', FAKE_TX);
        expect(created.list).not.toHaveBeenCalled();
    });

    it('counts the row the write is about to append as evidence', async () => {
        const { gate } = gateOf();

        await expect(reasonOf(gate.judge(writeOf({ pending: [WEB_ROW] })))).resolves.toBe('SOURCE_CONFLICT');
    });

    it('does not judge a write that leaves nothing published and public', async () => {
        const { gate } = gateOf([WEB_ROW]);
        const write = writeOf({
            after: { status: 'draft' as RecipeStatus, visibility: 'public' as RecipeVisibility },
            stored: { tx: FAKE_TX, recipeId: 'r1' },
            confirmation: undefined,
        });

        await expect(gate.judge(write)).resolves.toMatchObject({ sourceConflict: true });
    });
});

describe('PublicStatementGate.judge — the confirmation', () => {
    it('refuses a write that becomes published and public with no confirmation', async () => {
        const { gate } = gateOf();

        await expect(reasonOf(gate.judge(writeOf({ confirmation: undefined })))).resolves.toBe(
            'PUBLIC_CONFIRMATION_REQUIRED',
        );
    });

    it('does not ask a save of a recipe that was already published and public', async () => {
        const { gate } = gateOf();
        const live = { status: 'published' as RecipeStatus, visibility: 'public' as RecipeVisibility };

        await expect(gate.judge(writeOf({ before: live, confirmation: undefined }))).resolves.toMatchObject({
            recordsConfirmation: false,
        });
    });

    it('records a confirmation sent with a move of a draft to Public, without requiring it', async () => {
        const { gate } = gateOf();
        const write = writeOf({
            before: { status: 'draft' as RecipeStatus, visibility: 'private' as RecipeVisibility },
            after: { status: 'draft' as RecipeStatus, visibility: 'public' as RecipeVisibility },
        });

        await expect(gate.judge(write)).resolves.toMatchObject({ recordsConfirmation: true });
    });

    it('an explicit "I wrote this" in the same write satisfies the duty: no confirmation is needed', async () => {
        const { gate } = gateOf();

        await expect(
            gate.judge(writeOf({ confirmation: undefined, authoredInWrite: true, statementKind: 'authored' })),
        ).resolves.toMatchObject({ recordsConfirmation: true });
    });

    it('the statement answers only for itself: a write without it still owes the confirmation', async () => {
        const { gate } = gateOf();

        await expect(
            reasonOf(gate.judge(writeOf({ confirmation: undefined, statementKind: 'authored' }))),
        ).resolves.toBe('PUBLIC_CONFIRMATION_REQUIRED');
    });

    it('the import is exempt: nothing is required and nothing is recorded', async () => {
        const { gate } = gateOf();

        await expect(gate.judge(writeOf({ confirmation: undefined, confirmationExempt: true }))).resolves.toMatchObject(
            { recordsConfirmation: false },
        );
    });

    it('a refusal with a cause of its own is never masked by a missing confirmation', async () => {
        const { gate } = gateOf();

        await expect(
            reasonOf(gate.judge(writeOf({ contentPastedAt: new Date(), confirmation: undefined }))),
        ).resolves.toBe('STATEMENT_REQUIRED');
    });

    it('runs the caller’s check between the state rules and the confirmation', async () => {
        const order: string[] = [];
        const { gate } = gateOf();
        const write = writeOf({
            confirmation: undefined,
            afterState: () => {
                order.push('floor');
                throw new Error('floor');
            },
        });

        await expect(gate.judge(write)).rejects.toThrow('floor');
        expect(order).toEqual(['floor']);
    });
});

describe('PublicStatementGate.record', () => {
    it('appends the evidence, then the attestation rows, in the same transaction', async () => {
        const { gate, insert, insertMany } = gateOf();
        const calls: string[] = [];

        insert.mockImplementation(async () => void calls.push('evidence'));
        insertMany.mockImplementation(async () => void calls.push('attestations'));

        await gate.record(FAKE_TX, {
            recipeId: 'r1',
            accountId: 'u1',
            action: 'update',
            evidence: [WEB_ROW],
            statement: {
                kind: 'authored',
                wording: { version: 'statementAuthored.v1', locale: 'en' },
            },
            publicConfirmation: CONFIRM,
            recordsConfirmation: true,
        });

        expect(calls).toEqual(['evidence', 'attestations']);
        expect(insert).toHaveBeenCalledWith(FAKE_TX, { ...WEB_ROW, recipeId: 'r1' });
        expect(insertMany).toHaveBeenCalledWith(FAKE_TX, [
            expect.objectContaining({ recipeId: 'r1', accountId: 'u1', choice: 'authored', action: 'update' }),
            expect.objectContaining({ recipeId: 'r1', accountId: 'u1', choice: 'publicConfirm', action: 'update' }),
        ]);
    });

    it('writes nothing for a write that left no evidence and no row', async () => {
        const { gate, insert, insertMany } = gateOf();

        await gate.record(FAKE_TX, {
            recipeId: 'r1',
            accountId: 'u1',
            action: 'create',
            evidence: [],
            statement: undefined,
            publicConfirmation: undefined,
            recordsConfirmation: false,
        });

        expect(insert).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
    });
});
