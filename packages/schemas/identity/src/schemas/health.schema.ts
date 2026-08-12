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
 * `PUBLIC_PATHS` in the auth middleware exempts — and both are read by machinery rather than by a person: the
 * ECS container health check reads liveness, the ALB target group reads readiness. The payload is part of the
 * published contract because the `service` discriminator is what lets a probe tell "identity answered" from "the
 * shared ALB's default 404 answered" (ADR-0003).
 *
 * ── WHY `contractHash` IS PUBLISHED HERE, ON AN UNAUTHENTICATED ROUTE ──
 *
 * It is the SKEW SIGNAL for drift layer 3 (§15.2.5), and it mirrors `recipe-service`'s health payload field for
 * field so the three services agree. The boot assertion in `src/contract/contract-skew.ts` compares the two
 * stamps baked into ONE image, so it is structurally blind to the case the layer exists for — a deployed service
 * running ahead of a CONSUMER's pinned schema, which is the live problem for a released mobile binary that
 * cannot be updated in step with a backend deploy. That comparison is cross-process, so the service has to say
 * which contract it is serving, and it is on the unauthenticated probes because a consumer checking for skew
 * must be able to ask before it holds a credential. Publishing leaks nothing: the identical value already ships
 * inside every consumer as `CONTRACT_HASH` in `@kitchensink/schema-identity`.
 *
 * The client-side half is a WARNING, never a refusal (owner ruling, 2026-08-11).
 */
import { z } from 'zod';

/** A lower-case hex SHA-256 — the shape of every fingerprint the contract generator emits. */
const contractHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

/** The shape of the identity health/readiness payloads. */
export const healthStatusSchema = z.object({
    /** `ok` when the probe passed. A failing readiness probe answers `503` with the error envelope instead. */
    status: z.string(),
    /** Which service answered — `identity`. The discriminator distinguishing us from a default ALB response. */
    service: z.string(),
    /** The wire-contract fingerprint this binary was built against (drift layer 3, §15.2.5) — see the header. */
    contractHash: contractHashSchema,
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
