/**
 * `FoodPublicationService` (ADR-0029 §5, §7) — the author's request to make a food public, and staff's decision.
 *
 * DESIGN PATTERN: **Facade** over {@link PublicationRequestsDao}: it owns the translation from the DAO's tagged
 * outcomes to the published error envelope, and nothing else. The rules live in the pure `publicationRequestPolicy`,
 * the locks and the transaction in the DAO. Food never calls recipe-service; the recipe side learns of a promotion
 * through its own re-capture.
 */
import { Injectable } from '@nestjs/common';

import { apiError } from '../common/apiError.js';
import { AuthoredFoodsDao } from './dao/authoredFoods.dao.js';
import { PublicationRequestsDao } from './dao/publicationRequests.dao.js';
import type {
    AdminPublicationRequestList,
    PublicationDecisionRequest,
    PublicationRequest,
    OwnFoodList,
    PublicationRequestDetail,
} from './publication.schema.js';
import { OWN_FOODS_PAGE_SIZE } from './publication.schema.js';

@Injectable()
export class FoodPublicationService {
    public constructor(
        private readonly requests: PublicationRequestsDao,
        private readonly authored: AuthoredFoodsDao,
    ) {}

    /**
     * The author's own foods, newest edit first, with each one's publication state and the count of decisions they
     * have not opened.
     *
     * @param authorId - The verified caller's app-user ULID.
     * @param cursor - The previous page's `nextCursor`.
     * @sideEffect Reads three tables.
     */
    public async listOwn(authorId: string, cursor: string | undefined): Promise<OwnFoodList> {
        return this.authored.listOwn(authorId, {
            limit: OWN_FOODS_PAGE_SIZE,
            ...(cursor === undefined ? {} : { cursor }),
        });
    }

    /**
     * File the author's request against the food's newest version.
     *
     * @param authorId - The verified caller's app-user ULID.
     * @param foodId - The food.
     * @returns The request and its version; `created` is `false` when one was already pending (answered `200`).
     * @throws FOOD_NOT_FOUND (404) for a food the caller does not own; PUBLICATION_NOT_REQUESTABLE (409) when the food
     *   is withdrawn, not private, or this version was declined.
     * @sideEffect May insert one request row.
     */
    public async request(
        authorId: string,
        foodId: string,
    ): Promise<{ readonly created: boolean; readonly detail: PublicationRequestDetail }> {
        const result = await this.requests.request(foodId, authorId);

        if (result.kind === 'missing') {
            throw apiError('FOOD_NOT_FOUND', `Food '${foodId}' was not found`, { id: foodId });
        }

        if (result.kind === 'refused') {
            throw apiError(
                'PUBLICATION_NOT_REQUESTABLE',
                `Food '${foodId}' cannot be sent for publication: ${result.reason}`,
                { id: foodId, reason: result.reason },
            );
        }

        const detail = await this.requests.latestFor(foodId, authorId);

        if (detail === undefined) {
            throw new Error('a request just opened was not readable');
        }

        return { created: result.kind === 'opened', detail };
    }

    /**
     * The author's latest request for a food, with the version it points at.
     *
     * @param authorId - The verified caller's app-user ULID.
     * @param foodId - The food.
     * @throws PUBLICATION_REQUEST_NOT_FOUND (404) when the food has none, or is not the caller's.
     * @sideEffect Reads three tables; marks a decided request seen.
     */
    public async read(authorId: string, foodId: string): Promise<PublicationRequestDetail> {
        const detail = await this.requests.latestFor(foodId, authorId);

        if (detail === undefined) {
            throw apiError('PUBLICATION_REQUEST_NOT_FOUND', `Food '${foodId}' has no publication request`, {
                id: foodId,
            });
        }

        // Opening the food after a decision is what clears the dot on "Your foods" (revision 4, F19).
        await this.authored.markSeen(foodId, authorId);

        return detail;
    }

    /**
     * Staff's queue: every pending request, oldest first.
     *
     * @sideEffect Reads three tables.
     */
    public async listPending(): Promise<AdminPublicationRequestList> {
        return { requests: await this.requests.listPending() };
    }

    /**
     * Staff approve or decline one request.
     *
     * @param requestId - The request.
     * @param body - Approve, or decline with the reason the author reads.
     * @returns The decided request.
     * @throws PUBLICATION_REQUEST_NOT_FOUND (404); PUBLICATION_NOT_APPROVABLE (409) when it is closed, its food was
     *   withdrawn or a newer version replaced it; DUPLICATE_AUTHORED_NAME (409) when an approved rename now collides
     *   (the request stays pending).
     * @sideEffect Writes the request; on approval rewrites the food and sets it promoted.
     */
    public async decide(requestId: string, body: PublicationDecisionRequest): Promise<PublicationRequest> {
        const result = await this.requests.decide(
            requestId,
            body.approve ? { approve: true } : { decline: body.reason ?? '' },
        );

        switch (result.kind) {
            case 'approved':
            case 'declined':
                return result.request;

            case 'missing':
                throw apiError('PUBLICATION_REQUEST_NOT_FOUND', `Publication request '${requestId}' was not found`, {
                    id: requestId,
                });

            case 'refused':
                throw apiError(
                    'PUBLICATION_NOT_APPROVABLE',
                    `Publication request '${requestId}' cannot be decided: ${result.reason}`,
                    { id: requestId, reason: result.reason },
                );

            case 'duplicate':
                throw apiError(
                    'DUPLICATE_AUTHORED_NAME',
                    'The approved name collides with another of the author’s foods',
                    {
                        existingId: result.existingId,
                    },
                );

            default: {
                const unreachable: never = result;

                throw new Error(`unhandled decision outcome '${JSON.stringify(unreachable)}'`);
            }
        }
    }
}
