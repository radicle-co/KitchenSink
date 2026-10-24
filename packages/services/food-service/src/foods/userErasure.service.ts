/**
 * `UserErasureService` (T-056, FR-043/FR-044, R11) — the food-service entrypoint for user-erasure. On a
 * Clerk `user.deleted` event the platform must remove the deleted user's footprint from EVERY service.
 * This service owns the food-service half: it deletes that user's `fetch_requesters` rows — the ONLY
 * per-user data the food service stores (foods are shared reference data; there are deliberately no
 * `user_fetch_quota`/`global_fetch_quota` tables). Idempotent.
 *
 * ⚠️ The `svc_*` rows in that table (`svc_change_refresh`, `svc_admin_requeue`) are NOT user identity and
 * are deliberately out of scope here: they are constant named service principals, erasable by nothing and
 * belonging to no person.
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
 * user's app ULID and calls `eraseUser`. The handler/Lambda + IAM are out of scope here (CDK).
 *
 * @implements FR-043 FR-044 R5
 */
import { Inject, Injectable } from '@nestjs/common';

import { beginFoodErasure, eraseFoodRows } from './eraseFoodRows.js';
import { DrizzleProvider, type FoodDrizzle } from '../database/database.module.js';

/** The outcome of erasing one user. */
export interface EraseUserResult {
    /** The erased requester key (the app-user ULID). */
    readonly requesterId: string;
    /** The number of `fetch_requesters` rows removed. */
    readonly deletedRequesterRows: number;
    /** Authored foods deleted outright (unreferenced — Q3b's first arm). */
    readonly deletedAuthoredFoods: number;
    /** Authored foods KEPT as pseudonymous orphans (referenced — Q3b's second arm). */
    readonly keptAuthoredFoods: number;
}

@Injectable()
export class UserErasureService {
    public constructor(@Inject(DrizzleProvider) private readonly db: FoodDrizzle) {}

    /**
     * Erase a deleted user's food-service footprint: delete every `fetch_requesters` row keyed by the
     * user's app ULID (CR-002/U1 — no longer the Clerk `sub`).
     *
     * @param requesterId - The deleted user's app-user ULID (identity's `users.id`).
     * @returns The erased requester id and the number of removed requester rows.
     * @sideEffect Deletes from `fetch_requesters`.
     */
    public async eraseUser(requesterId: string, referencedFoodIds: readonly string[] = []): Promise<EraseUserResult> {
        // ⛔ Delegated to `eraseFoodRows` — the ONE raw-SQL sweep the erasure-coverage gate audits (plan
        // U17). Do not re-inline a builder call here: the gate cannot read one, and the sweep would go
        // back to being correct-but-unauditable.
        const outcome = await eraseFoodRows(this.db, requesterId, referencedFoodIds);

        return { requesterId, ...outcome };
    }

    /**
     * The erasure protocol's BEGIN step (plan U18): tombstone the owner's authored foods (the
     * `by-food`-refusal window) and hand the worker the ids its cross-service reference check needs.
     *
     * @param requesterId - The target owner's app-user ULID.
     * @returns The owner's authored food ids (tombstoned).
     * @sideEffect Flips authored foods to DELETING.
     */
    public async beginErasure(requesterId: string): Promise<{ authoredFoodIds: string[] }> {
        return beginFoodErasure(this.db, requesterId);
    }
}
