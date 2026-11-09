/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the food (ingredient) service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/food-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/food-service/src/foods/publication.schema.ts

/**
 * WIRE CONTRACT for publishing an authored food (ADR-0029 §5 and §7) — authored here and copied into
 * `@kitchensink/schema-food` (`docs/CODING_STANDARDS.md` §15.2).
 *
 * Two doors write it. The AUTHOR asks (`POST /api/v1/foods/authored/{id}/publication-request`) and reads the request
 * back (`GET` on the same path); an edit of a public food answers `202` with {@link editPendingResponseSchema}. STAFF
 * (`food:admin`) list the pending requests and decide them. A request names one `food_versions` row, and its
 * {@link publicationSnapshotSchema} is what that version says, so staff review exactly what approval would apply.
 *
 * ⛔ No person is named on any of these: the author is the food's `user_id`, and the staff member reaches the audit log
 * only. Anything added here must keep that true.
 */
import { z } from 'zod';

import { authoredMacrosSchema, authoredPortionInputSchema, publicationStateSchema } from './foods.schema.js';

/** The request's lifecycle. `closed` means a newer edit or a withdrawal replaced it; it is nobody's decision. */
export const publicationRequestStatusSchema = z.enum(['pending', 'approved', 'declined', 'closed']);

/** One publication request. */
export const publicationRequestSchema = z.object({
    id: z.string(),
    foodId: z.string(),
    /** The `food_versions` row the request is about. Approval applies this version and no other. */
    versionNumber: z.number().int().positive(),
    status: publicationRequestStatusSchema,
    /** The words the author reads. Present exactly when `status` is `declined`. */
    declineReason: z.string().nullable(),
    /** ISO 8601. */
    createdAt: z.string(),
    /** ISO 8601; `null` while pending. */
    decidedAt: z.string().nullable(),
});

export type PublicationRequest = z.infer<typeof publicationRequestSchema>;

/** What a food version says: the content staff review and approval applies. */
export const publicationSnapshotSchema = z.object({
    name: z.string(),
    description: z.string().nullable(),
    macros: authoredMacrosSchema,
    portions: z.array(authoredPortionInputSchema),
});

export type PublicationSnapshot = z.infer<typeof publicationSnapshotSchema>;

/** A request with the version it points at. The author's `GET` and the `POST` answer. */
export const publicationRequestDetailSchema = z.object({
    request: publicationRequestSchema,
    snapshot: publicationSnapshotSchema,
});

export type PublicationRequestDetail = z.infer<typeof publicationRequestDetailSchema>;

/** A pending request as staff see it: also the name readers see today, so a rename shows as a change. */
export const adminPublicationRequestSchema = publicationRequestDetailSchema.extend({
    liveName: z.string(),
});

/** `GET /api/v1/foods/admin/publication-requests`, oldest first. */
export const adminPublicationRequestListSchema = z.object({
    requests: z.array(adminPublicationRequestSchema),
});

export type AdminPublicationRequestList = z.infer<typeof adminPublicationRequestListSchema>;

/**
 * Body of `POST /api/v1/foods/admin/publication-requests/{id}/decision`: `{ approve: true }`, or
 * `{ approve: false, reason }` with the words the author reads.
 *
 * One object with a refinement rather than a union: a Nest DTO class cannot extend a union type, and the single shape
 * keeps `approve` the one field a reader looks at.
 */
export const publicationDecisionRequestSchema = z
    .strictObject({
        approve: z.boolean(),
        /** Required when declining, forbidden when approving. */
        reason: z.string().max(500).trim().min(1).optional(),
    })
    .refine((body) => body.approve === (body.reason === undefined), {
        message: 'A decline needs a reason, and an approval takes none',
        path: ['reason'],
    });

export type PublicationDecisionRequest = z.infer<typeof publicationDecisionRequestSchema>;

/** Query of `GET /api/v1/foods/admin/publication-requests`: the queue is the pending ones, and only that is served. */
export const publicationRequestsQuerySchema = z.strictObject({ status: z.literal('pending').optional() });

/** The `202` body of `PUT /api/v1/foods/{id}` on a public food: the edit is saved as a version and waits for staff. */
export const editPendingResponseSchema = z.object({
    publication: z.object({
        state: z.literal('editPending'),
        /** The version now waiting; readers keep the approved one. */
        versionNumber: z.number().int().positive(),
    }),
});

export type EditPendingResponse = z.infer<typeof editPendingResponseSchema>;

/** How many of the author's foods one page of `GET /api/v1/foods/authored` holds. */
export const OWN_FOODS_PAGE_SIZE = 50;

/** Query of `GET /api/v1/foods/authored`: the opaque cursor of the previous page. */
export const ownFoodListQuerySchema = z.strictObject({ cursor: z.string().max(512).optional() });

/** One of the author's foods in their list. */
export const ownFoodListItemSchema = z.object({
    id: z.string(),
    name: z.string(),
    publicationState: publicationStateSchema,
    /** ISO 8601: the last edit. */
    updatedAt: z.string(),
});

/** `GET /api/v1/foods/authored`: the author's foods, newest edit first. */
export const ownFoodListSchema = z.object({
    items: z.array(ownFoodListItemSchema),
    /** Pass as `cursor` for the next page; absent on the last. */
    nextCursor: z.string().optional(),
    /** Foods whose newest request was decided and not yet opened: the dot on "Your foods". */
    unseenDecisions: z.number().int().min(0),
});

export type OwnFoodList = z.infer<typeof ownFoodListSchema>;
