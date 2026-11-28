/**
 * The staff source correction (ADR-0100, plan everyAnswerSourceLock U3), over a fake DAL. What a database proves (the clone walk
 * across rows, the ratchet, the CHECK) is the LOCAL e2e tier's (`sourceCorrection.e2e.test.ts`); what is proved HERE is the order
 * of the work, what is written for each verdict, and what is logged.
 *
 * Every case reads the calls the service made, so a service that wrote in the wrong order, wrote twice, or wrote on a refusal fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeErrorCode } from '@kitchensink/recipe-core';

import type { RecipeTx } from '../../database/unitOfWork.js';
import type { Principal } from '../../auth/principal.js';
import { FAKE_TX } from '../__fixtures__/recipesDal.fixture.js';
import type { CorrectableRecipe } from '../domain/sourceCorrectionScopePolicy.js';
import type { SourceCorrectionsDal } from '../dal/sourceCorrections.dal.js';
import { SourceCorrectionService } from '../sourceCorrection.service.js';
import { SOURCE_CORRECT_SCOPE, type SourceCorrectionRequest } from '../recipes.schema.js';

const OWNER = '01JUOWNER000000000000000A1';
const STAFF = '01JUSTAFF0000000000000000A';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000c1';
const LINK = 'https://www.allrecipes.com/recipe/1/soup/';

const staff = (scopes: string[] = [SOURCE_CORRECT_SCOPE]): Principal => ({
    userId: STAFF,
    sub: 'clerk_staff',
    scopes,
    permissions: [],
    roles: [],
    principalKind: 'real',
    containment: 'enforce',
});

const BOOK_RECIPE: CorrectableRecipe = {
    ownerId: OWNER,
    sourceType: 'imported_physical',
    sourceKind: 'book',
    statementKind: 'source',
    sourceUrl: null,
    sourceAttribution: 'Joy of Cooking, p. 12',
};

const body = (over: Partial<SourceCorrectionRequest> = {}): SourceCorrectionRequest => ({
    ownerAccountId: OWNER,
    answer: { kind: 'public_web', citation: LINK },
    ground: 'ownerConfirmedByAccountEmail',
    reason: 'Owner asked by email; mailbox challenge passed.',
    ...over,
});

/** The calls, in order, so the ORDER of the work is an assertion. */
function build(recipe: CorrectableRecipe | null = BOOK_RECIPE, latestCorrectionId: string | null = null) {
    const calls: string[] = [];
    const rewrite = vi.fn<SourceCorrectionsDal['rewriteSource']>(() => {
        calls.push('rewrite');

        return Promise.resolve();
    });
    const record = vi.fn<SourceCorrectionsDal['recordCorrection']>(() => {
        calls.push('record');

        return Promise.resolve();
    });
    const holdClones = vi.fn(() => {
        calls.push('holdClones');

        return Promise.resolve();
    });
    const evidence = vi.fn(() => {
        calls.push('evidence');

        return Promise.resolve();
    });
    const lockRecipe = vi.fn(() => {
        calls.push('lockRecipe');

        return Promise.resolve(recipe ?? undefined);
    });
    const lockOwner = vi.fn(() => {
        calls.push('lockOwner');

        return Promise.resolve(0);
    });
    const readPreview = vi.fn(() => {
        calls.push('readPreview');

        return Promise.resolve(
            recipe === null
                ? undefined
                : { ...recipe, title: 'Tomato Soup', visibility: 'private' as const, sourceCorrectionHold: false },
        );
    });

    const transaction = async <T>(fn: (tx: RecipeTx) => Promise<T>): Promise<T> => {
        calls.push('begin');

        return fn(FAKE_TX);
    };

    const readLatestCorrectionId = vi.fn<(id: string) => Promise<string | null>>(() => {
        calls.push('readLatest');

        return Promise.resolve(latestCorrectionId);
    });

    const service = new SourceCorrectionService(
        { transaction, lockAndCountPrivateSlots: lockOwner },
        { lockRecipe, rewriteSource: rewrite, recordCorrection: record, holdOwnersClones: holdClones, readPreview },
        { insert: evidence },
        { readLatestCorrectionId },
    );

    return { service, calls, rewrite, record, holdClones, evidence, lockRecipe, lockOwner, readPreview };
}

const captured: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    captured.length = 0;
});

function captureLog(): void {
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
        captured.push(String(line));
    });
}

describe('SourceCorrectionService.correct', () => {
    it('a caller without the grant is forbidden BEFORE any database work', async () => {
        captureLog();
        const t = build();

        await expect(t.service.correct(staff([]), RECIPE_ID, body())).rejects.toMatchObject({ status: 403 });

        expect(t.calls).toEqual([]);
        expect(captured.join('\n')).toContain('source.correctionRefused');
        expect(captured.join('\n')).toContain('forbidden');
    });

    it('applies in one transaction, in the lock order: owner lock, recipe lock, rewrite, evidence, record, clones', async () => {
        const t = build();

        const result = await t.service.correct(staff(), RECIPE_ID, body());

        expect(result).toEqual({ result: 'applied' });
        expect(t.calls).toEqual(['begin', 'lockOwner', 'lockRecipe', 'rewrite', 'evidence', 'record', 'holdClones']);
        expect(t.lockOwner).toHaveBeenCalledWith(FAKE_TX, OWNER);
        expect(t.lockRecipe).toHaveBeenCalledWith(FAKE_TX, RECIPE_ID);
    });

    it('writes the new answer private, with the hold the policy named, and the evidence under the staffCorrection capture', async () => {
        const t = build();

        await t.service.correct(staff(), RECIPE_ID, body());

        expect(t.rewrite).toHaveBeenCalledTimes(1);
        expect(t.rewrite.mock.calls[0][0]).toBe(FAKE_TX);
        expect(t.rewrite.mock.calls[0][1]).toMatchObject({
            recipeId: RECIPE_ID,
            hold: false,
            provenance: { sourceKind: 'public_web', sourceUrl: LINK },
        });
        expect(t.evidence).toHaveBeenCalledWith(
            FAKE_TX,
            expect.objectContaining({ recipeId: RECIPE_ID, capture: 'staffCorrection', sourceKind: 'public_web' }),
        );
    });

    it('a correction to "I wrote this" holds the recipe and writes NO evidence', async () => {
        const t = build();

        await t.service.correct(staff(), RECIPE_ID, body({ answer: { kind: 'authored' } }));

        expect(t.rewrite).toHaveBeenCalledWith(FAKE_TX, expect.objectContaining({ hold: true }));
        expect(t.evidence).not.toHaveBeenCalled();
    });

    it('records ONE correction per apply, with the old and the new answer, the actor, the ground and the reason', async () => {
        const t = build();

        await t.service.correct(staff(), RECIPE_ID, body());

        expect(t.record).toHaveBeenCalledTimes(1);
        const [tx, written] = t.record.mock.calls[0];

        expect(tx).toBe(FAKE_TX);
        expect(written).toEqual({
            recipeId: RECIPE_ID,
            actorAccountId: STAFF,
            before: BOOK_RECIPE,
            after: written.after,
            ground: 'ownerConfirmedByAccountEmail',
            reason: 'Owner asked by email; mailbox challenge passed.',
        });
        expect(written.after).toMatchObject({ sourceKind: 'public_web', sourceUrl: LINK });
    });

    it('holds the OWNER’S clones on every apply, whether or not the recipe itself is held', async () => {
        for (const answer of [{ kind: 'authored' }, { kind: 'public_web', citation: LINK }] as const) {
            const t = build();

            await t.service.correct(staff(), RECIPE_ID, body({ answer }));

            expect(t.holdClones).toHaveBeenCalledTimes(1);
            expect(t.holdClones).toHaveBeenCalledWith(FAKE_TX, RECIPE_ID, OWNER);
        }
    });

    it('AE18: a correction that makes a recipe private is applied at a FULL private-slot count: the count is never a reason to refuse it', async () => {
        const t = build();

        t.lockOwner.mockResolvedValueOnce(50);

        await expect(t.service.correct(staff(), RECIPE_ID, body())).resolves.toEqual({ result: 'applied' });
        expect(t.rewrite).toHaveBeenCalledTimes(1);
        expect(t.holdClones).toHaveBeenCalledTimes(1);
    });

    it('a restatement is "unchanged": nothing is written, no record is made, nothing is held', async () => {
        const t = build();

        const result = await t.service.correct(
            staff(),
            RECIPE_ID,
            body({ answer: { kind: 'book', citation: 'Joy of Cooking, p. 12' } }),
        );

        expect(result).toEqual({ result: 'unchanged' });
        expect(t.rewrite).not.toHaveBeenCalled();
        expect(t.evidence).not.toHaveBeenCalled();
        expect(t.record).not.toHaveBeenCalled();
        expect(t.holdClones).not.toHaveBeenCalled();
    });

    it('a missing recipe and a recipe of another owner are the SAME 404, with nothing written', async () => {
        const missing = build(null);
        const other = build({ ...BOOK_RECIPE, ownerId: '01JUSOMEONEELSE00000000A1' });

        const a = await missing.service.correct(staff(), RECIPE_ID, body()).catch((error: unknown) => error);
        const b = await other.service.correct(staff(), RECIPE_ID, body()).catch((error: unknown) => error);

        for (const error of [a, b]) {
            expect(error).toMatchObject({ code: RecipeErrorCode.RECIPE_NOT_FOUND });
        }

        expect(a).toEqual(b);

        for (const t of [missing, other]) {
            expect(t.rewrite).not.toHaveBeenCalled();
            expect(t.record).not.toHaveBeenCalled();
        }
    });

    it('a recipe that holds no answer is a 400 invalid target, with nothing written', async () => {
        const t = build({ ...BOOK_RECIPE, sourceKind: null, statementKind: null, sourceType: 'user_created' });

        await expect(t.service.correct(staff(), RECIPE_ID, body())).rejects.toMatchObject({ status: 400 });

        expect(t.rewrite).not.toHaveBeenCalled();
        expect(t.record).not.toHaveBeenCalled();
    });

    it('a failure in the middle of the apply is not swallowed, and logs no correction', async () => {
        captureLog();
        const t = build();
        t.record.mockRejectedValueOnce(new Error('disk full'));

        await expect(t.service.correct(staff(), RECIPE_ID, body())).rejects.toThrow('disk full');

        expect(captured.join('\n')).not.toContain('"source.corrected"');
    });

    it('the log line of an apply names kinds and the ground only: no link, citation, reason or account id (Q-3)', async () => {
        captureLog();
        const t = build();

        await t.service.correct(staff(), RECIPE_ID, body());

        const line = captured.join('\n');

        expect(line).toContain('source.corrected');
        expect(line).toContain('"oldKind":"book"');
        expect(line).toContain('"newKind":"webPage"');

        for (const secret of [LINK, 'allrecipes', 'Joy of Cooking', 'mailbox challenge', OWNER, STAFF, RECIPE_ID]) {
            expect(line).not.toContain(secret);
        }
    });

    it('a refusal logs the refusal kind and the caller, and never the owner or the answer', async () => {
        captureLog();
        const t = build(null);

        await t.service.correct(staff(), RECIPE_ID, body()).catch(() => undefined);

        const line = captured.join('\n');

        expect(line).toContain('"refusal":"notFound"');
        expect(line).toContain(STAFF);
        expect(line).not.toContain(OWNER);
        expect(line).not.toContain(LINK);
    });
});

describe('SourceCorrectionService.preview', () => {
    it('shows the title, owner, answer and visibility of the recipe, with no transaction and no lock', async () => {
        const t = build();

        const preview = await t.service.preview(staff(), RECIPE_ID, OWNER);

        expect(preview).toEqual({
            title: 'Tomato Soup',
            ownerAccountId: OWNER,
            visibility: 'private',
            answer: { kind: 'book', citation: 'Joy of Cooking, p. 12' },
            sourceCorrected: false,
            latestCorrectionId: null,
        });
        expect(t.calls).toEqual(['readPreview', 'readLatest']);
        expect(t.rewrite).not.toHaveBeenCalled();
    });

    it('names the newest correction id the DAL reports, and null when the chain has none', async () => {
        await expect(
            build(BOOK_RECIPE, 'newest-row').service.preview(staff(), RECIPE_ID, OWNER),
        ).resolves.toMatchObject({ latestCorrectionId: 'newest-row' });
        await expect(build().service.preview(staff(), RECIPE_ID, OWNER)).resolves.toMatchObject({
            latestCorrectionId: null,
        });
    });

    it.each([
        ['own', { statementKind: 'authored', sourceKind: null, sourceType: 'user_created' }, null],
        ['person', { statementKind: 'fromPerson', sourceKind: null, sourceType: 'user_created' }, null],
        [
            'webPage',
            {
                sourceKind: 'public_web',
                sourceType: 'imported_public',
                sourceUrl: LINK,
                sourceAttribution: 'allrecipes.com',
            },
            LINK,
        ],
        [
            'paidSite',
            { sourceKind: 'paid_site', sourceType: 'imported_paid', sourceAttribution: 'Sam’s Site' },
            'Sam’s Site',
        ],
    ] as const)('cites a %s answer as the link, the citation or nothing', async (kind, over, citation) => {
        const t = build({ ...BOOK_RECIPE, ...over });

        await expect(t.service.preview(staff(), RECIPE_ID, OWNER)).resolves.toMatchObject({
            answer: { kind, citation },
        });
    });

    it('a recipe holding no answer shows answer null', async () => {
        const t = build({ ...BOOK_RECIPE, sourceKind: null, statementKind: null, sourceType: 'user_created' });

        await expect(t.service.preview(staff(), RECIPE_ID, OWNER)).resolves.toMatchObject({ answer: null });
    });

    it('forbidden is answered BEFORE any read, and logs the refusal', async () => {
        captureLog();
        const t = build();

        await expect(t.service.preview(staff([]), RECIPE_ID, OWNER)).rejects.toMatchObject({ status: 403 });

        expect(t.calls).toEqual([]);
        expect(captured.join('\n')).toContain('"refusal":"forbidden"');
    });

    it('a missing recipe and a wrong owner are the same 404, and the refusal log names neither the owner nor the title', async () => {
        captureLog();
        const missing = build(null);
        const other = build({ ...BOOK_RECIPE, ownerId: '01JUSOMEONEELSE00000000A1' });

        const a = await missing.service.preview(staff(), RECIPE_ID, OWNER).catch((error: unknown) => error);
        const b = await other.service.preview(staff(), RECIPE_ID, OWNER).catch((error: unknown) => error);

        expect(a).toMatchObject({ code: RecipeErrorCode.RECIPE_NOT_FOUND });
        expect(a).toEqual(b);

        const line = captured.join('\n');

        expect(line).toContain('"refusal":"notFound"');

        for (const secret of [OWNER, 'Tomato Soup', 'Joy of Cooking']) {
            expect(line).not.toContain(secret);
        }
    });

    it('a successful preview logs nothing', async () => {
        captureLog();

        await build().service.preview(staff(), RECIPE_ID, OWNER);

        expect(captured).toEqual([]);
    });
});
