/**
 * Unit tests for {@link ParseJobMatchesDal}'s own logic: the short circuits that must not reach the database, and the
 * projection of a stored row into the domain match. The SQL itself (the CHECKs, the cascade, the first-writer upsert,
 * the claim) is the LOCAL e2e tier's: `tests/e2e/parseJobs/parseJobMatches.e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { RecipeDrizzle } from '../../../database/client.js';
import { makeFakeDrizzle } from '../../../__testing__/makeFakeDrizzle.js';
import { ParseJobMatchesDal } from '../parseJobMatches.dal.js';

const JOB = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const OWNER = '01JMATCHESUNITOWNER000000A';

/** A stored row as Drizzle returns it under the `match` alias, with its line's digest now. */
function storedRow(overrides: Record<string, unknown> = {}) {
    return {
        lineDigestNow: 'digest-now',
        match: {
            jobId: JOB,
            lineIndex: 0,
            foodIndex: 1,
            lineDigest: 'digest',
            judgementDigest: 'j1:k',
            review: 'owed',
            matchedBy: 'memo',
            foodId: null,
            foodVariantId: 'V-1',
            rung: null,
            margin: null,
            candidates: [{ kind: 'variant', id: 'V-1', rung: null }],
            verificationKey: 'v2:k',
            enqueuedAt: null,
            createdAt: new Date(),
            ...overrides,
        },
    };
}

describe('ParseJobMatchesDal', () => {
    it('issues NO statement for an empty save, claim or release', async () => {
        const control = makeFakeDrizzle<RecipeDrizzle>();
        const dal = new ParseJobMatchesDal(control.db);

        await dal.saveMatches(JOB, []);
        expect(await dal.claimEnqueue(JOB, [], 60)).toEqual([]);
        await dal.releaseEnqueue(JOB, []);

        expect(control.calls).toEqual([]);
    });

    it('reads a VARIANT proposal back on the variant arm', async () => {
        const control = makeFakeDrizzle<RecipeDrizzle>();
        control.enqueue([storedRow()]);

        const [match] = await new ParseJobMatchesDal(control.db).findForJob(OWNER, JOB);

        expect(match?.proposal).toEqual({
            matchedBy: 'memo',
            food: { kind: 'variant', id: 'V-1' },
            rung: null,
            margin: null,
        });
    });

    it('reads a row with no food as NO proposal, never a half one', async () => {
        const control = makeFakeDrizzle<RecipeDrizzle>();
        control.enqueue([
            storedRow({ matchedBy: null, foodVariantId: null, verificationKey: null, review: null, candidates: [] }),
        ]);

        const [match] = await new ParseJobMatchesDal(control.db).findForJob(OWNER, JOB);

        expect(match?.proposal).toBeNull();
        expect(match?.candidates).toEqual([]);
    });

    it('reads the line’s stored digest NOW beside the row’s own, and the review disposition', async () => {
        const control = makeFakeDrizzle<RecipeDrizzle>();
        control.enqueue([storedRow()]);

        const [match] = await new ParseJobMatchesDal(control.db).findForJob(OWNER, JOB);

        expect(match).toMatchObject({
            lineDigest: 'digest',
            lineDigestNow: 'digest-now',
            judgementDigest: 'j1:k',
            review: 'owed',
        });
    });

    it('reads a stored rung this build does not know as NO rung — food owns the vocabulary', async () => {
        const control = makeFakeDrizzle<RecipeDrizzle>();
        control.enqueue([
            storedRow({ rung: 'superExact', candidates: [{ kind: 'variant', id: 'V-1', rung: 'superExact' }] }),
        ]);

        const [match] = await new ParseJobMatchesDal(control.db).findForJob(OWNER, JOB);

        expect(match?.proposal?.rung).toBeNull();
        expect(match?.candidates).toEqual([{ kind: 'variant', id: 'V-1', rung: null }]);
    });

    it('⛔ THROWS on a review disposition this build does not know', async () => {
        const control = makeFakeDrizzle<RecipeDrizzle>();
        control.enqueue([storedRow({ review: 'parked' })]);

        await expect(new ParseJobMatchesDal(control.db).findForJob(OWNER, JOB)).rejects.toThrow();
    });

    it('⛔ THROWS on a stored row this build cannot read — the writer is this service, so it is a defect', async () => {
        const control = makeFakeDrizzle<RecipeDrizzle>();
        control.enqueue([storedRow({ candidates: [{ kind: 'dish', id: 'x' }] })]);

        await expect(new ParseJobMatchesDal(control.db).findForJob(OWNER, JOB)).rejects.toThrow();
    });
});
