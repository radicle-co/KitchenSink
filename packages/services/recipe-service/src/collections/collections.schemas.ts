/**
 * Zod request validators for the Collections controller, mirroring the request schemas in
 * `api.openapi.yaml` (`CreateCollectionRequest`, `UpdateCollectionRequest`,
 * `AddRecipeToCollectionRequest`, and the `Page`/`PageSize` query parameters). The controller is the
 * first validation gate (malformed body/query → 400); the service independently re-enforces the
 * visibility rule (FR-010 / T140) so it is never solely dependent on this layer.
 */
import { z } from 'zod';

/** `public` | `private`, per the OpenAPI `visibility` enum. */
export const visibilitySchema = z.enum(['public', 'private']);

/** `CreateCollectionRequest`. */
export const createCollectionSchema = z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
    visibility: visibilitySchema.optional(),
});

/** `UpdateCollectionRequest` — at least one field must be present (`minProperties: 1`). */
export const updateCollectionSchema = z
    .object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(1000).optional(),
        visibility: visibilitySchema.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, { message: 'At least one field must be provided.' });

/** `AddRecipeToCollectionRequest`. */
export const addRecipeSchema = z.object({
    recipeId: z.string().uuid(),
});

/**
 * `CloneCollectionRequest` (FR-011) — both fields optional, so the body itself is optional: a plain
 * `POST /api/v1/collections/{id}/clone` with no body inherits the source's name/description. Bounds mirror
 * `createCollectionSchema` so a clone can never carry a name the create path would have rejected.
 */
export const cloneCollectionSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(1000).optional(),
});

/** `Page` / `PageSize` query parameters (coerced from strings; defaults 1 / 20; pageSize capped at 100). */
export const pageQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** The three-way pull diff shape a client echoes back on commit (W8-a.8). */
export const pullDiffSchema = z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    unchanged: z.array(z.string()),
});

/**
 * Body of `POST :id/pull-from-source` (W8-a.8): OPTIONAL `previewedDiff` — the diff the client saw in the
 * preview, echoed back as the drift baseline. Absent → apply directly (no drift guard, back-compatible).
 */
export const pullCommitSchema = z.object({
    previewedDiff: pullDiffSchema.optional(),
});

/** Parsed create body. */
export type CreateCollectionBody = z.infer<typeof createCollectionSchema>;
/** Parsed update body. */
export type UpdateCollectionBody = z.infer<typeof updateCollectionSchema>;
/** Parsed add-recipe body. */
export type AddRecipeBody = z.infer<typeof addRecipeSchema>;
/** Parsed pagination query. */
export type PageQuery = z.infer<typeof pageQuerySchema>;
