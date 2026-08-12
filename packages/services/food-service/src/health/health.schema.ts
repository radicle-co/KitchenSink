/**
 * WIRE CONTRACT for the food service's health probes — authored here and copied into
 * `@kitchensink/schema-food` (`docs/CODING_STANDARDS.md` §15.2).
 *
 * Both `/health` (liveness) and `/health/ready` (readiness) are UNAUTHENTICATED — the `FoodAuthGuard` is
 * mounted only on `/api/v1/foods/*` — and both are consumed by machinery rather than by a person: the ECS
 * container health check reads liveness, the ALB target group reads readiness, and the sandbox deploy smoke
 * reads both. That is why the payload is part of the published contract: the `service` discriminator is what
 * lets a probe tell "the food service answered" from "the shared ALB's default 404 answered" (ADR-0003), and
 * the deploy gate depends on being able to make that distinction (ADR-0010).
 *
 * ── WHY `contractHash` IS PUBLISHED HERE, ON AN UNAUTHENTICATED ROUTE ──
 *
 * It is the SKEW SIGNAL for drift layer 3 (§15.2.5), and it mirrors `recipe-service`'s health payload field for
 * field so the three services agree. The boot assertion in `src/contract/contract-skew.ts` compares the two
 * stamps baked into ONE image, so it is structurally blind to the case the layer exists for — a deployed
 * service running ahead of a CONSUMER's pinned schema, which is the live problem for a released mobile binary
 * that cannot be updated in step with a backend deploy. That comparison is cross-process, so the service has to
 * say which contract it is serving, and it is on the unauthenticated probes because a consumer checking for skew
 * must be able to ask before it holds a credential. Publishing leaks nothing: the identical value already ships
 * inside every consumer as `CONTRACT_HASH` in `@kitchensink/schema-food`.
 *
 * The client-side half is a WARNING, never a refusal (owner ruling, 2026-08-11): see
 * `packages/clients/food-service/src/contractSkew.ts`.
 */
import { z } from 'zod';

/** A lower-case hex SHA-256 — the shape of every fingerprint the contract generator emits. */
const contractHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

/** The shape of the food health/readiness payloads. */
export const healthStatusSchema = z.object({
    /** `ok` when the probe passed. A failing readiness probe answers `503` with the error envelope instead. */
    status: z.string(),
    /** Which service answered — `food`. The discriminator that distinguishes us from a default ALB response. */
    service: z.string(),
    /** The wire-contract fingerprint this binary was built against (drift layer 3, §15.2.5) — see the header. */
    contractHash: contractHashSchema,
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
