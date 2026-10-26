/**
 * How `ParseJobsDal.createJob` reads the allowance's answer (ADR-0072 §8).
 *
 * A parse job is ONE unit. Since the allowance learned to admit part of a request, `createJob` has a third answer to
 * handle, and the only safe reading of "part of one unit" is a defect that rolls the transaction back: returning would
 * charge the ledger for a job that is then refused.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { makeFakeDrizzle } from '../../../__testing__/makeFakeDrizzle.js';
import type { ImportAllowanceDal } from '../../../common/dal/importAllowance.dal.js';
import type { RecipeDrizzle } from '../../../database/client.js';
import { ParseJobsDal } from '../parseJobs.dal.js';

const OWNER = '01JADMISSIONOWNER000000001';
const EXPIRES = new Date('2026-10-27T12:00:00.000Z');
const CHARGE = { kind: 'charge', channel: 'paste', units: 1, tier: { isPremium: false } } as const;

function dalAnswering(answer: Awaited<ReturnType<ImportAllowanceDal['admit']>>) {
    const control = makeFakeDrizzle<RecipeDrizzle>();
    const allowance = { admit: () => Promise.resolve(answer) } as unknown as ImportAllowanceDal;

    return { control, dal: new ParseJobsDal(control.db, {} as pg.Pool, allowance) };
}

describe('ParseJobsDal.createJob reads the allowance answer', () => {
    it('returns a refusal untouched, and writes nothing', async () => {
        const resetsAt = new Date('2026-10-27T01:00:00.000Z');
        const { control, dal } = dalAnswering({ kind: 'refused', resetsAt });
        const outcome = await dal.createJob(OWNER, [], EXPIRES, CHARGE);

        expect(outcome).toEqual({ kind: 'refused', resetsAt });
        // Nothing past the allowance ran: no job insert, no line insert.
        expect(control.calls.filter((call) => call.method === 'insert')).toEqual([]);
    });

    it('⛔ treats an admission of PART of a one-unit job as a defect, so the transaction rolls back', async () => {
        const { control, dal } = dalAnswering({ kind: 'partial', units: 1, resetsAt: EXPIRES });

        await expect(dal.createJob(OWNER, [], EXPIRES, CHARGE)).rejects.toThrow(/part of a single-unit parse job/u);
        expect(control.calls.filter((call) => call.method === 'insert')).toEqual([]);
    });
});
