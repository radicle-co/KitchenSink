/**
 * `PublicationRequestsDao` (ADR-0029 §5, §7) — the author's request to make a food public, and staff's decision on it.
 *
 * DESIGN PATTERN: Repository over `food_publication_requests`, with every decision delegated to the pure
 * `publicationRequestPolicy`. The DAO's job is the LOCK ORDER (request, then food) and the transaction: it reads the
 * facts under lock, asks the policy, and writes the verdict, so a stale "newest version" or "not withdrawn" cannot
 * survive to the write.
 *
 * Staff identity never reaches this class: it is an audit-log fact, and the table has no person column.
 */
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { FoodTx, FoodWriter } from '../../database/unitOfWork.js';

import { food, foodPublicationRequests, foodVersions } from '../../db/schema/index.js';
import {
    decideApproval,
    decideRequest,
    type ApprovalRefusal,
    type RequestRefusal,
} from '../domain/publicationRequestPolicy.js';
import { isUniqueViolation } from './dao.errors.js';
import { narrowVisibility, rewriteLiveRow } from './authoredFoods.dao.js';
import { normalizeName } from '../foodName.js';
import { publicationSnapshotSchema, type PublicationSnapshot } from '../publication.schema.js';

/** A request as the wire carries it. */
export interface PublicationRequestRecord {
    readonly id: string;
    readonly foodId: string;
    readonly versionNumber: number;
    readonly status: 'pending' | 'approved' | 'declined' | 'closed';
    readonly declineReason: string | null;
    readonly createdAt: string;
    readonly decidedAt: string | null;
}

export type VersionSnapshot = PublicationSnapshot;

/** A request with the version it points at. */
export interface PublicationRequestWithSnapshot {
    readonly request: PublicationRequestRecord;
    readonly snapshot: VersionSnapshot;
}

/** A pending request as staff see it: also the name readers see today. */
export interface PendingPublicationRequest extends PublicationRequestWithSnapshot {
    readonly liveName: string;
}

export type RequestResult =
    | { readonly kind: 'opened' | 'existing'; readonly request: PublicationRequestRecord }
    | { readonly kind: 'refused'; readonly reason: RequestRefusal }
    | { readonly kind: 'missing' };

export type PublicationDecision = { readonly approve: true } | { readonly decline: string };

export type DecideResult =
    | { readonly kind: 'approved' | 'declined'; readonly request: PublicationRequestRecord }
    | { readonly kind: 'refused'; readonly reason: ApprovalRefusal }
    | { readonly kind: 'duplicate'; readonly existingId: string }
    | { readonly kind: 'missing' };

interface RequestRow {
    id: string;
    foodId: string;
    foodVersionNumber: number;
    status: string;
    declineReason: string | null;
    createdAt: Date;
    decidedAt: Date | null;
}

/** The status column is CHECKed; narrowing it is honesty about the text type. Pure. */
function narrowStatus(status: string): PublicationRequestRecord['status'] {
    if (status === 'pending' || status === 'approved' || status === 'declined' || status === 'closed') {
        return status;
    }

    throw new Error(`unknown publication request status '${status}'`);
}

/** Project a row to the wire record. Pure. */
function recordOf(row: RequestRow): PublicationRequestRecord {
    return {
        id: row.id,
        foodId: row.foodId,
        versionNumber: row.foodVersionNumber,
        status: narrowStatus(row.status),
        declineReason: row.declineReason,
        createdAt: row.createdAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
    };
}

export class PublicationRequestsDao {
    public constructor(private readonly db: FoodWriter) {}

    /**
     * File the author's request against the food's newest version.
     *
     * @param foodId - The food.
     * @param authorId - The verified caller; a food they do not own is `missing`, as for any stranger.
     * @returns `opened`, `existing` (idempotent), `refused` with a reason, or `missing`.
     * @sideEffect Locks the food row; may insert one request.
     */
    public async request(foodId: string, authorId: string): Promise<RequestResult> {
        return this.db.transaction(async (tx: FoodTx) => {
            const locked = await tx.execute<{ visibility: string; status: string }>(sql`
                SELECT visibility, status FROM food WHERE id = ${foodId} AND user_id = ${authorId} FOR UPDATE
            `);
            const facts = locked.rows[0];

            if (facts === undefined) {
                return { kind: 'missing' };
            }

            const newest = await this.newestVersion(tx, foodId);
            const requests = await tx
                .select()
                .from(foodPublicationRequests)
                .where(eq(foodPublicationRequests.foodId, foodId));
            const pending = requests.find((row) => row.status === 'pending');
            const decision = decideRequest({
                visibility: narrowVisibility(facts.visibility),
                status: facts.status,
                newestVersion: newest,
                pendingVersion: pending?.foodVersionNumber,
                declinedVersions: requests
                    .filter((row) => row.status === 'declined')
                    .map((row) => row.foodVersionNumber),
            });

            if (decision.kind === 'refused') {
                return decision;
            }

            if (decision.kind === 'existing' && pending !== undefined) {
                return { kind: 'existing', request: recordOf(pending) };
            }

            const [inserted] = await tx
                .insert(foodPublicationRequests)
                .values({ foodId, foodVersionNumber: newest })
                .returning();

            if (inserted === undefined) {
                throw new Error('the request insert returned no row');
            }

            return { kind: 'opened', request: recordOf(inserted) };
        });
    }

    /**
     * The author's latest request for a food and the version it points at.
     *
     * @param foodId - The food.
     * @param authorId - The verified caller.
     * @returns The latest request, or `undefined` when there is none or the food is not theirs.
     * @sideEffect Reads `food`, `food_publication_requests`, `food_versions`.
     */
    public async latestFor(foodId: string, authorId: string): Promise<PublicationRequestWithSnapshot | undefined> {
        const rows = await this.db
            .select({ request: foodPublicationRequests, snapshot: foodVersions.snapshot })
            .from(foodPublicationRequests)
            .innerJoin(food, eq(food.id, foodPublicationRequests.foodId))
            .innerJoin(
                foodVersions,
                and(
                    eq(foodVersions.foodId, foodPublicationRequests.foodId),
                    eq(foodVersions.versionNumber, foodPublicationRequests.foodVersionNumber),
                ),
            )
            .where(and(eq(foodPublicationRequests.foodId, foodId), eq(food.userId, authorId)))
            .orderBy(desc(foodPublicationRequests.createdAt), desc(foodPublicationRequests.foodVersionNumber))
            .limit(1);
        const row = rows[0];

        return row === undefined
            ? undefined
            : { request: recordOf(row.request), snapshot: publicationSnapshotSchema.parse(row.snapshot) };
    }

    /**
     * Every pending request, oldest first: staff's review queue.
     *
     * @sideEffect Reads three tables.
     */
    public async listPending(): Promise<PendingPublicationRequest[]> {
        const rows = await this.db
            .select({ request: foodPublicationRequests, snapshot: foodVersions.snapshot, liveName: food.name })
            .from(foodPublicationRequests)
            .innerJoin(food, eq(food.id, foodPublicationRequests.foodId))
            .innerJoin(
                foodVersions,
                and(
                    eq(foodVersions.foodId, foodPublicationRequests.foodId),
                    eq(foodVersions.versionNumber, foodPublicationRequests.foodVersionNumber),
                ),
            )
            .where(eq(foodPublicationRequests.status, 'pending'))
            .orderBy(foodPublicationRequests.createdAt);

        return rows.map((row) => ({
            request: recordOf(row.request),
            snapshot: publicationSnapshotSchema.parse(row.snapshot),
            liveName: row.liveName ?? '',
        }));
    }

    /**
     * Staff approve or decline one request.
     *
     * Approval, in ONE transaction: lock the request, lock the food, ask the policy (still pending, food live,
     * version still the newest), apply that version's snapshot to the live row, set `visibility = 'promoted'`, mark
     * it approved. A rename that now collides with the author's other food answers `duplicate` and the request stays
     * pending. Food never calls recipe-service.
     *
     * @param requestId - The request.
     * @param decision - Approve, or decline with the reason the author will read.
     * @returns The outcome.
     * @sideEffect Locks and writes `food_publication_requests`; on approval rewrites the food.
     */
    public async decide(requestId: string, decision: PublicationDecision): Promise<DecideResult> {
        let attempt: { foodId: string; authorId: string; normalizedName: string } | undefined;

        try {
            return await this.db.transaction(async (tx: FoodTx) => {
                const found = await tx.execute<{ food_id: string }>(sql`
                    SELECT food_id FROM food_publication_requests WHERE id = ${requestId} FOR UPDATE
                `);
                const foodId = found.rows[0]?.food_id;

                if (foodId === undefined) {
                    return { kind: 'missing' };
                }

                const [request] = await tx
                    .select()
                    .from(foodPublicationRequests)
                    .where(eq(foodPublicationRequests.id, requestId));
                const locked = await tx.execute<{ status: string; user_id: string | null }>(sql`
                    SELECT status, user_id FROM food WHERE id = ${foodId} FOR UPDATE
                `);
                const foodRow = locked.rows[0];

                if (request === undefined || foodRow === undefined) {
                    return { kind: 'missing' };
                }

                if ('decline' in decision) {
                    if (request.status !== 'pending') {
                        return { kind: 'refused', reason: 'closed' };
                    }

                    const [declined] = await tx
                        .update(foodPublicationRequests)
                        .set({ status: 'declined', declineReason: decision.decline, decidedAt: sql`now()` })
                        .where(eq(foodPublicationRequests.id, requestId))
                        .returning();

                    return { kind: 'declined', request: recordOf(requireRow(declined)) };
                }

                const verdict = decideApproval({
                    requestStatus: request.status,
                    requestVersion: request.foodVersionNumber,
                    newestVersion: await this.newestVersion(tx, foodId),
                    foodStatus: foodRow.status,
                });

                if (verdict.kind === 'refused') {
                    return verdict;
                }

                const [version] = await tx
                    .select({ snapshot: foodVersions.snapshot })
                    .from(foodVersions)
                    .where(
                        and(eq(foodVersions.foodId, foodId), eq(foodVersions.versionNumber, request.foodVersionNumber)),
                    );
                const snapshot = publicationSnapshotSchema.parse(version?.snapshot);
                const authorId = foodRow.user_id;

                if (authorId === null) {
                    return { kind: 'missing' };
                }

                attempt = { foodId, authorId, normalizedName: normalizeName(snapshot.name) };

                const applied = await rewriteLiveRow(tx, {
                    id: foodId,
                    userId: authorId,
                    name: snapshot.name,
                    normalizedName: attempt.normalizedName,
                    description: snapshot.description,
                    macros: snapshot.macros,
                    portions: snapshot.portions,
                });

                if (!applied) {
                    return { kind: 'refused', reason: 'withdrawn' };
                }

                await tx.update(food).set({ visibility: 'promoted' }).where(eq(food.id, foodId));
                const [approved] = await tx
                    .update(foodPublicationRequests)
                    .set({ status: 'approved', decidedAt: sql`now()` })
                    .where(eq(foodPublicationRequests.id, requestId))
                    .returning();

                return { kind: 'approved', request: recordOf(requireRow(approved)) };
            });
        } catch (error) {
            if (isUniqueViolation(error) && attempt !== undefined) {
                return this.duplicateOf(attempt);
            }

            throw error;
        }
    }

    /** The newest version number of a food, read under the caller's lock. @sideEffect Reads `food_versions`. */
    private async newestVersion(tx: FoodTx, foodId: string): Promise<number> {
        const rows = await tx.execute<{ newest: number | null }>(sql`
            SELECT MAX(version_number) AS newest FROM food_versions WHERE food_id = ${foodId}
        `);

        return rows.rows[0]?.newest ?? 0;
    }

    /**
     * After a unique violation in the approval's rewrite: the author's other live food holding the name. The failed
     * transaction rolled back, so the request is still pending. `ne(status, 'WITHDRAWN')` mirrors the partial unique
     * index (0017), as `AuthoredFoodsDao` does.
     */
    private async duplicateOf(attempt: {
        foodId: string;
        authorId: string;
        normalizedName: string;
    }): Promise<DecideResult> {
        const rows = await this.db
            .select({ id: food.id })
            .from(food)
            .where(
                and(
                    eq(food.normalizedName, attempt.normalizedName),
                    eq(food.userId, attempt.authorId),
                    ne(food.status, 'WITHDRAWN'),
                    ne(food.id, attempt.foodId),
                ),
            );
        const existingId = rows[0]?.id;

        if (existingId === undefined) {
            throw new Error('an approval hit a unique violation that names no other food');
        }

        return { kind: 'duplicate', existingId };
    }
}

/** A `RETURNING` of one updated row; its absence inside the lock is a defect. Pure. */
function requireRow<T>(row: T | undefined): T {
    if (row === undefined) {
        throw new Error('an update under lock returned no row');
    }

    return row;
}
