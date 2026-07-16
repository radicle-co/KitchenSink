/**
 * T134-test (domain) — unit tests for the active-erasure-status guard.
 *
 * Requirement → test map:
 *
 *   - **C-007 / data-model.md** — "in flight" means exactly `queued` | `running`: the predicate of the
 *     `idx_erasure_jobs_active_owner` partial unique index AND the `202` response's `status` enum in
 *     `api.openapi.yaml`. The terminal statuses (`completed`, `failed`) are NOT active — conflating them
 *     would either resurrect an erased account or wedge a retry.
 *     → `describe('isActiveErasureJobStatus')`
 */
import { describe, it, expect } from 'vitest';

import { ERASURE_JOB_STATUSES, ACTIVE_ERASURE_JOB_STATUSES } from '../../../database/schema/account.js';
import { isActiveErasureJobStatus } from '../erasure-status.js';

describe('isActiveErasureJobStatus', () => {
    it.each(['queued', 'running'])('accepts the in-flight status %s', (status) => {
        expect(isActiveErasureJobStatus(status)).toBe(true);
    });

    it.each(['completed', 'failed'])('rejects the terminal status %s', (status) => {
        expect(isActiveErasureJobStatus(status)).toBe(false);
    });

    it.each(['', 'QUEUED', 'Running', 'queued ', 'pending', 'in_flight'])('rejects the non-status %j', (status) => {
        expect(isActiveErasureJobStatus(status)).toBe(false);
    });

    it('accepts exactly the two statuses the partial unique index predicate covers', () => {
        expect(ERASURE_JOB_STATUSES.filter(isActiveErasureJobStatus)).toEqual(['queued', 'running']);
    });

    it('draws its values from the authoritative schema enum (every active status is a real status)', () => {
        for (const status of ACTIVE_ERASURE_JOB_STATUSES) {
            expect(ERASURE_JOB_STATUSES).toContain(status);
        }
    });
});
