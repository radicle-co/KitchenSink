/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the identity service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/identity-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/identity/src/health/health.schema.ts

/**
 * WIRE CONTRACT for the identity service's health probes — authored here and copied into
 * `@kitchensink/schema-identity` (`docs/CODING_STANDARDS.md` §15.2).
 *
 * Both `/health` (liveness) and `/health/ready` (readiness) are UNAUTHENTICATED — they are the only paths
 * `PUBLIC_PATHS` in the auth middleware exempts — and both are read by machinery rather than by a person: the ECS
 * container health check reads liveness, the ALB target group reads readiness. The payload is part of the
 * published contract because the `service` discriminator is what lets a probe tell "identity answered" from "the
 * shared ALB's default 404 answered" (ADR-0003).
 */
import { z } from 'zod';

/** The shape of the identity health/readiness payloads. */
export const healthStatusSchema = z.object({
    /** `ok` when the probe passed. A failing readiness probe answers `503` with the error envelope instead. */
    status: z.string(),
    /** Which service answered — `identity`. The discriminator distinguishing us from a default ALB response. */
    service: z.string(),
});

/** The shape of the identity health/readiness payloads. */
export type HealthStatus = z.infer<typeof healthStatusSchema>;
