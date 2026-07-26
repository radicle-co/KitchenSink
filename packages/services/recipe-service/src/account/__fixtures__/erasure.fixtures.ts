/**
 * `make*` fixtures for the account-erasure unit tests. Each accepts a `Partial` override and returns a
 * fully-populated value, so the service/DAL/controller mapping can be exercised without a database or
 * a live SQS queue.
 */
import type { AccountErasureJobRow } from '../../database/schema/account.js';
import type { ActiveErasureJob } from '../dal/erasure-jobs.dal.js';

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

/** An `account_erasure_jobs` row (owner `owner-1`, freshly `queued`) with overridable fields. */
export function makeErasureJobRow(overrides: Partial<AccountErasureJobRow> = {}): AccountErasureJobRow {
    return {
        id: '00000000-0000-4000-8000-0000000000e1',
        ownerId: 'owner-1',
        status: 'queued',
        attempts: 0,
        lastError: null,
        publishRecipeIds: null,
        removedRecipeIds: null,
        // CR-002 / U4a R8 audit fields — a fixture defaults to a user-triggered, owner-confirmed job.
        triggerSource: 'user',
        actor: 'owner-1',
        confirmedAt: FIXED_DATE,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
        ...overrides,
    };
}

/** The narrowed in-flight job the DAL hands the service (`queued`/`running` only). */
export function makeActiveErasureJob(overrides: Partial<ActiveErasureJob> = {}): ActiveErasureJob {
    return {
        id: '00000000-0000-4000-8000-0000000000e1',
        status: 'queued',
        ...overrides,
    };
}
