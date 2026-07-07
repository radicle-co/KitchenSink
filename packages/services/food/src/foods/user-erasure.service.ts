/**
 * `UserErasureService` (T-056, FR-043/FR-044) — the food-service entrypoint for user-erasure. On a
 * Clerk `user.deleted` event the platform must remove the deleted `sub`'s footprint from EVERY service.
 * This service owns the food-service half: it deletes that `sub`'s `fetch_requesters` rows — the ONLY
 * per-user data the food service stores (foods are shared reference data; there are deliberately no
 * `user_fetch_quota`/`global_fetch_quota` tables). Idempotent.
 *
 * Wiring (deferred to infra): the Clerk `user.deleted` webhook is handled in
 * `packages/services/identity-webhooks` and the existing async deletion worker. The food service should
 * hook in by either (a) subscribing a small food-service deletion Lambda to the same erasure
 * SQS/EventBridge fan-out the identity deletion worker drives, or (b) the identity deletion worker
 * calling the food service's M2M erasure path (FR-047). Either way the handler resolves the deleted
 * Clerk `sub` and calls {@link eraseUser}. The handler/Lambda + IAM are out of scope here (CDK).
 *
 * @implements FR-043 FR-044
 */
import { Inject, Injectable } from '@nestjs/common';

import { FetchRequestersDao } from './dao/fetch-requesters.dao.js';
import { DrizzleProvider, type FoodDrizzle } from '../database/database.module.js';

/** The outcome of erasing one user. */
export interface EraseUserResult {
    /** The erased `sub`. */
    readonly sub: string;
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
     * Erase a deleted user's food-service footprint: delete every `fetch_requesters` row for the `sub`.
     *
     * @param sub - The deleted user's Clerk `sub`.
     * @returns The erased `sub` and the number of removed requester rows.
     * @sideEffect Deletes from `fetch_requesters`.
     */
    public async eraseUser(sub: string): Promise<EraseUserResult> {
        const deletedRequesterRows = await this.requesters.deleteForSub(sub);

        return { sub, deletedRequesterRows };
    }
}
