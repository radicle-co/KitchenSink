/**
 * `UserErasureService` (T-056, FR-043/FR-044, R11) — the food-service entrypoint for user-erasure. On a
 * Clerk `user.deleted` event the platform must remove the deleted user's footprint from EVERY service.
 * This service owns the food-service half: it deletes that user's `fetch_requesters` rows — the ONLY
 * per-user data the food service stores (foods are shared reference data; there are deliberately no
 * `user_fetch_quota`/`global_fetch_quota` tables). Idempotent.
 *
 * **CR-002/U1 (R5).** The user footprint is keyed by the app-user **ULID** (identity's `users.id`), NOT
 * the Clerk `sub`. `eraseUser` therefore takes the ULID. This unit only makes the erasure leg
 * key-correct; wiring the actual caller (the deletion-worker fan-out) is U4b/R11 — `eraseUser` remains
 * dead code until then.
 *
 * Wiring (deferred to infra): the Clerk `user.deleted` webhook is handled in
 * `packages/services/identity-webhooks` and the existing async deletion worker. The food service should
 * hook in by either (a) subscribing a small food-service deletion Lambda to the same erasure
 * SQS/EventBridge fan-out the identity deletion worker drives, or (b) the identity deletion worker
 * calling the food service's M2M erasure path (FR-047). Either way the handler resolves the deleted
 * user's app ULID and calls {@link eraseUser}. The handler/Lambda + IAM are out of scope here (CDK).
 *
 * @implements FR-043 FR-044 R5
 */
import { Inject, Injectable } from '@nestjs/common';

import { FetchRequestersDao } from './dao/fetch-requesters.dao.js';
import { DrizzleProvider, type FoodDrizzle } from '../database/database.module.js';

/** The outcome of erasing one user. */
export interface EraseUserResult {
    /** The erased requester key (the app-user ULID). */
    readonly requesterId: string;
    /** The number of `fetch_requesters` rows removed. */
    readonly deletedRequesterRows: number;
}

@Injectable()
export class UserErasureService {
    private readonly requesters: FetchRequestersDao;

    public constructor(@Inject(DrizzleProvider) db: FoodDrizzle) {
        this.requesters = new FetchRequestersDao(db);
    }

    /**
     * Erase a deleted user's food-service footprint: delete every `fetch_requesters` row keyed by the
     * user's app ULID (CR-002/U1 — no longer the Clerk `sub`).
     *
     * @param requesterId - The deleted user's app-user ULID (identity's `users.id`).
     * @returns The erased requester id and the number of removed requester rows.
     * @sideEffect Deletes from `fetch_requesters`.
     */
    public async eraseUser(requesterId: string): Promise<EraseUserResult> {
        const deletedRequesterRows = await this.requesters.deleteForRequester(requesterId);

        return { requesterId, deletedRequesterRows };
    }
}
