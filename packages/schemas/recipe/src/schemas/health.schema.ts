/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the recipe service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/recipe-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/recipe-service/src/health/health.schema.ts

/**
 * AUTHORED WIRE CONTRACT for the health surface (`GET /health`, `GET /health/ready`).
 *
 * SOURCE OF TRUTH for these shapes. Copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY
 * `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules — enforced by
 * `@kitchensink/contract-gen`'s import restriction (configured in `contract/generate.ts`).
 *
 * DESIGN PATTERN: single-source schema + inferred type. Two schemas rather than one widened shape, because the
 * two payloads genuinely differ: the ready/live body carries the contract fingerprint, the `503` body does not
 * (a service that cannot reach its database has no business asserting anything about its contract), and
 * collapsing them would force `status` to a bare `string` — losing the one field a probe actually branches on.
 *
 * ── WHY `contractHash` IS PUBLISHED HERE, ON AN UNAUTHENTICATED ROUTE ──
 *
 * It is the SKEW SIGNAL for drift layer 3 (§15.2.5). A boot-time comparison inside the service can only catch
 * an image whose own two stamps disagree; it cannot see the case the layer exists for — a deployed service
 * running ahead of a CONSUMER's pinned schema, which is the live problem for a released mobile binary. That
 * comparison is cross-process, so the service has to say which contract it is serving.
 *
 * Publishing it leaks nothing: the identical value already ships inside every web bundle and mobile binary as
 * `CONTRACT_HASH` in `@kitchensink/schema-recipe`, so a client can compute the comparison either way. What this
 * adds is the OTHER half — and it is on the liveness route on purpose, because a consumer checking for skew
 * must be able to ask before it holds a credential.
 */
import { z } from 'zod';

/** A lower-case hex SHA-256 — the shape of every fingerprint the contract generator emits. */
const contractHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

/** Body of a successful `GET /health` or `GET /health/ready`. */
export const healthStatusSchema = z.object({
    /** Always `ok`. A `503` carries the error envelope (`code: NOT_READY`) rather than a variant of this. */
    status: z.literal('ok'),
    /** Which service answered, so a misrouted probe is obvious rather than mysteriously green. */
    service: z.literal('recipe'),
    /**
     * The wire-contract fingerprint this binary was built against — the same value
     * `@kitchensink/schema-recipe` publishes as `CONTRACT_HASH`. A consumer whose pinned copy differs is
     * talking to a service whose contract has moved.
     */
    contractHash: contractHashSchema,
});

/** A successful health payload. */
export type HealthStatus = z.infer<typeof healthStatusSchema>;

// ⛔ `healthUnavailableSchema` / `HealthUnavailable` USED TO BE HERE and are GONE.
//
// It described `{ status: 'unavailable', service: 'recipe' }` — the readiness `503`'s own body, which was a
// FIFTH error shape on this service's wire. It existed only because `ApiExceptionFilter` passed an
// `HttpException`'s response through unchanged; once the filter became the sole author of every error body, a
// bespoke failure shape for one route stopped being expressible without a passthrough branch, and the branch is
// the defect.
//
// `HealthController.getReadiness` now raises `apiError('NOT_READY', …)`, so the `503` carries the standard
// `{ code, message }` envelope like every other failure — which a consumer can branch on, where
// `status: 'unavailable'` merely restated the HTTP status in the body.
//
// ⚠️ This retires a PUBLISHED component, and the safety was verified rather than assumed: the only producer was
// that one throw, the only other references were this schema and the document, and every consumer of
// `/health/ready` — the ALB target group, ECS, and the sandbox deploy smoke — reads the STATUS, not the body.
// Searched across `packages/` and `.github/` before deleting.
//
// The `200` body (`healthStatusSchema`) is UNTOUCHED, including its `contractHash`, which is drift layer 3's
// skew signal and is genuinely read by a consumer.
