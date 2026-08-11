/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the food (ingredient) service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/food-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/food-service/src/health/health.schema.ts

/**
 * WIRE CONTRACT for the food service's health probes — authored here and copied into
 * `@kitchensink/schema-food` (`docs/CODING_STANDARDS.md` §15.2).
 *
 * Both `/health` (liveness) and `/health/ready` (readiness) are UNAUTHENTICATED — the `FoodAuthGuard` is
 * mounted only on `/api/v1/foods/*` — and both are consumed by machinery rather than by a person: the ECS
 * container health check reads liveness, the ALB target group reads readiness, and the sandbox deploy smoke
 * reads both. That is precisely why the payload is part of the published contract: the `service` discriminator
 * is what lets a probe tell "the food service answered" from "the shared ALB's default 404 answered"
 * (ADR-0003), and the deploy gate depends on being able to make that distinction (ADR-0010).
 */
import { z } from 'zod';

/** The shape of the food health/readiness payloads. */
export const healthStatusSchema = z.object({
    /** `ok` when the probe passed. A failing readiness probe answers `503` with the error envelope instead. */
    status: z.string(),
    /** Which service answered — `food`. The discriminator that distinguishes us from a default ALB response. */
    service: z.string(),
});

/** The shape of the food health/readiness payloads. */
export type HealthStatus = z.infer<typeof healthStatusSchema>;
