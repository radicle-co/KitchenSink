/**
 * THE PROMOTION-MODERATION WIRE CONTRACT (plan U12) — the three admin routes under
 * `/api/v1/foods/admin/promotions/*`, authored here and copied into `@kitchensink/schema-food`
 * (`docs/CODING_STANDARDS.md` §15.2).
 *
 * Admin-scoped (FR-039/FR-051): the pending list exposes private authored foods' names, and the two
 * decision routes publish or bar user-authored data — `403` without the `food:admin` scope.
 *
 * Corroboration is the TRIGGER, never the PUBLISHER (owner ruling 2026-08-30): a row here was queued by
 * cross-author agreement (`promotionPolicy.ts`) and only the approve route makes anything world-readable.
 */
import { z } from 'zod';

/** One pending (or decided) promotion-queue row, as the admin surface reads it. */
export const promotionQueueRowSchema = z.object({
    /** The queue row id (UUID, 0015). */
    id: z.string(),
    /** The normalized food name the candidacy is about. */
    normalizedName: z.string(),
    /** The compatible contributing foods, ordered by id — the reviewed unit. */
    candidateFoodIds: z.array(z.string()),
    /** The candidacy's data identity — bars identical resubmission after a rejection. */
    dataFingerprint: z.string(),
    status: z.enum(['pending', 'approved', 'rejected']),
    /** The elected survivor; set at approval, `null` before and on rejection. */
    canonicalFoodId: z.string().nullable(),
    createdAt: z.string(),
    decidedAt: z.string().nullable(),
});

export type PromotionQueueRowView = z.infer<typeof promotionQueueRowSchema>;

/** Response of `GET /api/v1/foods/admin/promotions/pending`. */
export const pendingPromotionsResponseSchema = z.object({
    /** The pending moderation queue, oldest first. */
    pending: z.array(promotionQueueRowSchema),
});

export type PendingPromotionsResponse = z.infer<typeof pendingPromotionsResponseSchema>;

/** Response of `POST /api/v1/foods/admin/promotions/{id}/approve` — phase 1 committed. */
export const approvePromotionResponseSchema = z.object({
    /** The decided queue row. */
    id: z.string(),
    /** The elected canonical, now `promoted` and world-readable. */
    canonicalFoodId: z.string(),
    /** The name it holds — what phase 2's recipe-side mapping rewrite binds. */
    normalizedName: z.string(),
});

export type ApprovePromotionResponse = z.infer<typeof approvePromotionResponseSchema>;

/** Response of `POST /api/v1/foods/admin/promotions/{id}/reject`. */
export const rejectPromotionResponseSchema = z.object({
    /** The decided queue row. */
    id: z.string(),
    status: z.literal('rejected'),
});

export type RejectPromotionResponse = z.infer<typeof rejectPromotionResponseSchema>;
