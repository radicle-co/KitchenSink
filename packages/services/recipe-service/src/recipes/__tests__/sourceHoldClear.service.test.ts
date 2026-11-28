/**
 * The staff hold clear and the earned clear (ADR-0106), over a fake DAL. What a database proves (the walk across rows, the
 * ratchet, the locks against a second connection) is `tests/e2e/recipes/holdClear*.e2e.test.ts`; what is proved HERE is the order of
 * the work, what is written for each verdict, what is logged, and that the earned path opens nothing of its own.
 *
 * Every case reads the calls the service made, so a service that wrote in the wrong order, wrote on a refusal, or logged twice fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';

import type { RecipeTx } from '../../database/unitOfWork.js';
import type { Principal } from '../../auth/principal.js';
import { FAKE_TX } from '../__fixtures__/recipesDal.fixture.js';
import type { CorrectionChainRow } from '../dal/sourceHoldClears.dal.js';
import { SOURCE_CORRECT_SCOPE, type SourceHoldClearRequest } from '../recipes.schema.js';
import { SourceHoldClearService, type HoldClearsPort } from '../sourceHoldClear.service.js';

const OWNER = '01JUOWNER000000000000000A1';
const STAFF = '01JUSTAFF0000000000000000A';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000c1';
const ROW_ID = '00000000-0000-4000-8000-0000000000e1';

const staff = (scopes: string[] = [SOURCE_CORRECT_SCOPE]): Principal => ({
    userId: STAFF,
    sub: 'clerk_staff',
    scopes,
    permissions: [],
    roles: [],
    principalKind: 'real',
    containment: 'enforce',
});

const row = (over: Partial<CorrectionChainRow> = {}): CorrectionChainRow => ({
    id: ROW_ID,
    recipeId: RECIPE_ID,
    newSourceType: 'imported_physical',
    newSourceKind: 'book',
    newStatementKind: 'source',
    ...over,
});
const OWN_ROW = row({ newSourceType: 'user_created', newSourceKind: null, newStatementKind: 'authored' });
const PERSON_ROW = row({ newSourceType: 'user_created', newSourceKind: null, newStatementKind: 'fromPerson' });

const body = (over: Partial<SourceHoldClearRequest> = {}): SourceHoldClearRequest => ({
    ownerAccountId: OWNER,
    correctionId: ROW_ID,
    reason: 'The owner asked; mailbox challenge passed.',
    ...over,
});

interface Setup {
    readonly held?: boolean;
    readonly missing?: boolean;
    readonly otherOwner?: boolean;
    readonly chain?: readonly CorrectionChainRow[];
    /** The newest correction id across the whole chain; defaults to the id the request names. */
    readonly latest?: string | null;
    readonly released?: readonly string[];
    readonly transactionFails?: Error;
    /** The body runs and the transaction then rejects, as a failed COMMIT does. */
    readonly commitFails?: Error;
}

function build(setup: Setup = {}) {
    const calls: string[] = [];
    const log = <T>(name: string, value: T) =>
        vi.fn<(...args: unknown[]) => Promise<T>>(() => {
            calls.push(name);

            return Promise.resolve(value);
        });
    const lockOwner = log('slotLock', 0);
    const lockHoldFacts = vi.fn(() => {
        calls.push('lockRow');

        return Promise.resolve(
            setup.missing === true
                ? undefined
                : { ownerId: setup.otherOwner === true ? 'other' : OWNER, held: setup.held ?? true },
        );
    });
    const readCorrectionChain = log('readChain', setup.chain ?? [row()]);
    const readLatestCorrectionId = log('readLatest', setup.latest === undefined ? ROW_ID : setup.latest);
    const lockOwnersDescendants = log('lockDescendants', undefined);
    const releasableDescendants = log('derive', setup.released ?? []);
    const recordClears = log('record', undefined);
    const releaseHolds = log('release', undefined);
    const beginCount = { n: 0 };

    const transaction = async <T>(fn: (tx: RecipeTx) => Promise<T>): Promise<T> => {
        calls.push('begin');
        beginCount.n += 1;

        if (setup.transactionFails !== undefined) {
            throw setup.transactionFails;
        }

        const result = await fn(FAKE_TX);

        if (setup.commitFails !== undefined) {
            throw setup.commitFails;
        }

        return result;
    };

    const dal: HoldClearsPort = {
        lockHoldFacts,
        readCorrectionChain,
        readLatestCorrectionId,
        lockOwnersDescendants,
        releasableDescendants,
        recordClears,
        releaseHolds,
    };
    const service = new SourceHoldClearService({ transaction, lockAndCountPrivateSlots: lockOwner }, dal);

    return {
        service,
        calls,
        recordClears,
        releaseHolds,
        beginCount,
        lockOwner,
        lockHoldFacts,
        readCorrectionChain,
        readLatestCorrectionId,
        lockOwnersDescendants,
        releasableDescendants,
    };
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

const metricLines = (): Array<Record<string, unknown>> =>
    captured
        .filter((line) => line.includes('source.holdCleared'))
        .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('SourceHoldClearService.clearByStaff', () => {
    it('a caller without the grant is forbidden BEFORE any database work, and the refusal is logged', async () => {
        captureLog();
        const t = build();

        await expect(t.service.clearByStaff(staff([]), RECIPE_ID, body())).rejects.toMatchObject({ status: 403 });

        expect(t.calls).toEqual([]);
        expect(captured.join('\n')).toContain('"refusal":"forbidden"');
    });

    it('works in the order slot lock, recipe row, chain, descendants lock, derive, record, release', async () => {
        captureLog();
        const t = build();

        await expect(t.service.clearByStaff(staff(), RECIPE_ID, body())).resolves.toEqual({
            result: 'cleared',
            released: 1,
        });

        expect(t.calls).toEqual([
            'begin',
            'slotLock',
            'lockRow',
            'readLatest',
            'lockDescendants',
            'derive',
            'record',
            'release',
        ]);
    });

    it('records the root and each released clone, with the actor and the trimmed reason, then releases the same ids', async () => {
        captureLog();
        const t = build({ released: ['c2', 'c3'] });

        await expect(t.service.clearByStaff(staff(), RECIPE_ID, body({ reason: '  mistaken  ' }))).resolves.toEqual({
            result: 'cleared',
            released: 3,
        });

        expect(t.recordClears).toHaveBeenCalledWith(FAKE_TX, {
            recipeIds: [RECIPE_ID, 'c2', 'c3'],
            cause: 'staff',
            actorAccountId: STAFF,
            reason: 'mistaken',
        });
        expect(t.releaseHolds).toHaveBeenCalledWith(FAKE_TX, [RECIPE_ID, 'c2', 'c3']);
    });

    it('emits ONE metric line after the commit, valued at the holds cleared: 1 with no clones, 3 with two', async () => {
        captureLog();

        await build().service.clearByStaff(staff(), RECIPE_ID, body());
        await build({ released: ['c2', 'c3'] }).service.clearByStaff(staff(), RECIPE_ID, body());

        expect(metricLines().map((line) => line['source.holdCleared'])).toEqual([1, 3]);
    });

    it('a wrong owner and a missing recipe are one 404, write nothing and emit no clear metric', async () => {
        captureLog();

        for (const setup of [{ missing: true }, { otherOwner: true }]) {
            const t = build(setup);

            await expect(t.service.clearByStaff(staff(), RECIPE_ID, body())).rejects.toMatchObject({
                code: 'RECIPE_NOT_FOUND',
            });
            expect(t.recordClears).not.toHaveBeenCalled();
            expect(t.releaseHolds).not.toHaveBeenCalled();
        }

        expect(metricLines()).toEqual([]);
    });

    it.each([
        ['a recipe that is not held', { held: false }, 'HOLD_NOT_SET'],
        ['a correction that is no longer the newest', { latest: 'newer' }, 'CORRECTION_NOT_LATEST'],
    ] as const)(
        'refuses %s with HOLD_CLEAR_CONFLICT (409), writes nothing and emits no metric',
        async (_name, setup, reason) => {
            captureLog();
            const t = build(setup);

            await expect(t.service.clearByStaff(staff(), RECIPE_ID, body())).rejects.toMatchObject({
                code: 'HOLD_CLEAR_CONFLICT',
                details: { reason },
            });

            expect(t.recordClears).not.toHaveBeenCalled();
            expect(t.releaseHolds).not.toHaveBeenCalled();
            expect(metricLines()).toEqual([]);
        },
    );

    it('maps a deadlock (40P01) to HOLD_CLEAR_CONFLICT (409) LOCK_CONFLICT, never a 500, and emits no metric', async () => {
        captureLog();
        const t = build({
            transactionFails: Object.assign(new DatabaseError('deadlock detected', 0, 'error'), { code: '40P01' }),
        });

        await expect(t.service.clearByStaff(staff(), RECIPE_ID, body())).rejects.toMatchObject({
            code: 'HOLD_CLEAR_CONFLICT',
            details: { reason: 'LOCK_CONFLICT' },
        });
        expect(metricLines()).toEqual([]);
    });

    it('passes the caller transaction to every read and lock, so none runs on the pool outside the row lock', async () => {
        captureLog();
        const t = build();

        await t.service.clearByStaff(staff(), RECIPE_ID, body());

        expect(t.lockHoldFacts).toHaveBeenCalledWith(FAKE_TX, RECIPE_ID);
        expect(t.readLatestCorrectionId).toHaveBeenCalledWith(RECIPE_ID, FAKE_TX);
        expect(t.lockOwnersDescendants).toHaveBeenCalledWith(FAKE_TX, RECIPE_ID, OWNER);
        expect(t.releasableDescendants).toHaveBeenCalledWith(FAKE_TX, RECIPE_ID, OWNER);
    });

    it('passes the caller transaction to the earned clear reads too', async () => {
        const t = build();

        await t.service.clearByEarnedRewrite(FAKE_TX, RECIPE_ID);

        expect(t.lockHoldFacts).toHaveBeenCalledWith(FAKE_TX, RECIPE_ID);
        expect(t.readCorrectionChain).toHaveBeenCalledWith(RECIPE_ID, FAKE_TX);
    });

    it('lets a Postgres error with another code (a unique violation) through unchanged, not as LOCK_CONFLICT', async () => {
        const failure = Object.assign(new DatabaseError('duplicate key', 0, 'error'), { code: '23505' });
        const t = build({ transactionFails: failure });

        await expect(t.service.clearByStaff(staff(), RECIPE_ID, body())).rejects.toBe(failure);
    });

    it('maps the deadlock as Drizzle really throws it: a DrizzleQueryError wrapping the driver error', async () => {
        captureLog();
        const driver = Object.assign(new DatabaseError('deadlock detected', 0, 'error'), { code: '40P01' });
        const t = build({ transactionFails: new DrizzleQueryError('update recipes', [], driver) });

        await expect(t.service.clearByStaff(staff(), RECIPE_ID, body())).rejects.toMatchObject({
            code: 'HOLD_CLEAR_CONFLICT',
            details: { reason: 'LOCK_CONFLICT' },
        });
    });

    it('logs the refusal line, with the route, before it throws LOCK_CONFLICT', async () => {
        captureLog();
        const driver = Object.assign(new DatabaseError('deadlock detected', 0, 'error'), { code: '40P01' });
        const t = build({ transactionFails: new DrizzleQueryError('update recipes', [], driver) });

        await expect(t.service.clearByStaff(staff(), RECIPE_ID, body())).rejects.toBeDefined();

        expect(captured.join('\n')).toContain('"refusal":"LOCK_CONFLICT"');
        expect(captured.join('\n')).toContain('"route":"holdClear"');
    });

    it('emits no metric when the commit fails AFTER the body ran (the line is written only after the commit)', async () => {
        captureLog();
        const t = build({ commitFails: new Error('commit failed') });

        await expect(t.service.clearByStaff(staff(), RECIPE_ID, body())).rejects.toThrow('commit failed');

        expect(t.recordClears).toHaveBeenCalledTimes(1);
        expect(metricLines()).toEqual([]);
    });

    it('never reads the full chain on the staff path, so an unclassifiable row cannot make it fail', async () => {
        captureLog();
        const t = build({
            chain: [row({ newSourceType: 'user_created', newSourceKind: null, newStatementKind: null })],
        });

        await expect(t.service.clearByStaff(staff(), RECIPE_ID, body())).resolves.toMatchObject({ result: 'cleared' });
        expect(t.calls).not.toContain('readChain');
    });

    it('lets any other database error through unchanged', async () => {
        const failure = new Error('connection reset');
        const t = build({ transactionFails: failure });

        await expect(t.service.clearByStaff(staff(), RECIPE_ID, body())).rejects.toBe(failure);
    });
});

describe('SourceHoldClearService.clearByEarnedRewrite', () => {
    it('clears the recipe in the CALLER transaction: opens none, takes no slot lock, walks no clones, emits no metric', async () => {
        captureLog();
        const t = build({ chain: [row(), row({ id: 'r2', newSourceKind: 'paid_site' })] });

        await expect(t.service.clearByEarnedRewrite(FAKE_TX, RECIPE_ID)).resolves.toEqual({ cleared: true });

        expect(t.beginCount.n).toBe(0);
        expect(t.lockOwner).not.toHaveBeenCalled();
        expect(t.calls).toEqual(['lockRow', 'readChain', 'record', 'release']);
        expect(t.recordClears).toHaveBeenCalledWith(FAKE_TX, {
            recipeIds: [RECIPE_ID],
            cause: 'earnedRewrite',
            actorAccountId: null,
            reason: 'earnedRewrite',
        });
        expect(metricLines()).toEqual([]);
    });

    it.each([
        ['notHeld', { held: false }],
        ['notHeld', { missing: true }],
        ['noCorrectionRow', { chain: [] }],
        ['ownAnswerInChain', { chain: [row(), OWN_ROW] }],
        ['fromPersonAnswerInChain', { chain: [row(), PERSON_ROW] }],
    ] as const)('answers %s without writing: nothing recorded, nothing released', async (reason, setup) => {
        const t = build(setup);

        await expect(t.service.clearByEarnedRewrite(FAKE_TX, RECIPE_ID)).resolves.toEqual({ cleared: false, reason });

        expect(t.recordClears).not.toHaveBeenCalled();
        expect(t.releaseHolds).not.toHaveBeenCalled();
    });

    it('treats a row with no answer as a corrupt row (an invariant error), so the reason union stays closed', async () => {
        const t = build({
            chain: [row({ newSourceKind: null, newStatementKind: null, newSourceType: 'user_created' })],
        });

        await expect(t.service.clearByEarnedRewrite(FAKE_TX, RECIPE_ID)).rejects.toThrow(/correction row/);
    });
});
