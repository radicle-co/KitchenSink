/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the food (ingredient) service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/food-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/food-service/src/foods/dto/serviceErasure.schema.ts

/**
 * WIRE CONTRACT for the food service-principal erasure route `POST /api/v1/internal/account/erasure`
 * (CR-002 / U4b / R11) — authored here and copied into `@kitchensink/schema-food`
 * (`docs/CODING_STANDARDS.md` §15.2).
 *
 * There is deliberately NO request-body schema, and its absence is the security property: the target owner is
 * bound in the verified service token, never supplied by the caller. Adding an `ownerId` field here would
 * create exactly the smuggling surface the route was designed without.
 *
 * The response surfaces the erased requester key and how many `fetch_requesters` rows were removed. The row
 * count is the RESIDUE SIGNAL the erasure-reconciliation sweep reads — a re-drive that deletes `> 0` rows means
 * the leg had not previously completed — so it is part of the contract, not a debugging nicety. An owner with
 * no food footprint is an idempotent no-op: `0` rows.
 */
import { z } from 'zod';

/** Body for `POST /api/v1/internal/account/erasure` (`200`, synchronous and idempotent). */
export const foodServiceErasureAcceptedResponseSchema = z.object({
    /** The erased requester key — the bound app-user ULID (echoed from the verified token). */
    requesterId: z.string(),
    /** The number of `fetch_requesters` rows removed (0 when there was no footprint / already erased). */
    deletedRequesterRows: z.number(),
    /** U18: authored foods deleted outright (Q3b's unreferenced arm). Absent pre-U18 responses parse fine. */
    deletedAuthoredFoods: z.number().int().min(0).optional(),
    /** U18: authored foods kept as pseudonymous orphans (Q3b's referenced arm). */
    keptAuthoredFoods: z.number().int().min(0).optional(),
});

/** Body for `POST /api/v1/internal/account/erasure`. */
export type FoodServiceErasureAcceptedResponse = z.infer<typeof foodServiceErasureAcceptedResponseSchema>;

/**
 * Response of `POST /api/v1/internal/account/erasure/begin` (plan U18): the tombstoned authored food ids
 * the deletion worker feeds to recipe-service's reference check.
 */
export const foodServiceErasureBeginResponseSchema = z.object({
    authoredFoodIds: z.array(z.string()),
});

export type FoodServiceErasureBeginResponse = z.infer<typeof foodServiceErasureBeginResponseSchema>;

/**
 * Body of `POST /api/v1/internal/account/erasure` (plan U18) — OPTIONAL, and carrying NO authority: the
 * owner still comes only from the verified token; this list only says which of the owner's foods the
 * worker found still referenced (Q3b's orphan arm). Absent/empty ⇒ everything deletes.
 */
export const foodServiceErasureRequestSchema = z.preprocess(
    // The deletion worker's PRE-U18 caller sends NO body at all; Nest hands the pipe `undefined` for a
    // body-less POST, and a bare object schema refuses that with a 400 — which is a wire break for the
    // deployed worker. An absent body IS the empty request.
    (value) => value ?? {},
    z.object({
        referencedFoodIds: z.array(z.string()).max(10_000).optional(),
    }),
);

export type FoodServiceErasureRequest = z.infer<typeof foodServiceErasureRequestSchema>;
