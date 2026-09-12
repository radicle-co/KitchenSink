/**
 * AUTHORED WIRE CONTRACT for the health surface (`GET /health`, `GET /health/ready`).
 *
 * SOURCE OF TRUTH; copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY `zod`,
 * `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules (allowlist in `contract/config.ts`).
 *
 * DESIGN PATTERN: single-source schema + inferred type. ⛔ Do NOT collapse the success body and the failure body
 * into one widened shape: only the success body carries the contract fingerprint (a service that cannot reach its
 * database has no business asserting anything about its contract), and widening would force `status` to a bare
 * `string` — losing the one field a probe branches on.
 *
 * ── WHY `contractHash` IS PUBLISHED HERE, ON AN UNAUTHENTICATED ROUTE ──
 *
 * It is the SKEW SIGNAL for drift layer 3 (§15.2.5), whose case is a deployed service running ahead of a
 * CONSUMER's pinned schema (the live problem for a released mobile binary). That comparison is cross-process, so
 * a boot-time self-check inside the service cannot make it — the service has to say which contract it serves.
 *
 * Publishing it leaks nothing: the identical value already ships inside every web bundle and mobile binary as
 * `CONTRACT_HASH` in `@kitchensink/schema-recipe`. It sits on the LIVENESS route on purpose, because a consumer
 * checking for skew must be able to ask before it holds a credential.
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
    /** The fingerprint this binary was built against — `@kitchensink/schema-recipe`'s `CONTRACT_HASH`. */
    contractHash: contractHashSchema,
});

/** A successful health payload. */
export type HealthStatus = z.infer<typeof healthStatusSchema>;

// ⛔ There is deliberately NO schema for the readiness `503` body, and one must not be added back.
// `HealthController.getReadiness` raises `apiError('NOT_READY', …)`, so the failure carries the standard
// `{ code, message }` envelope like every other error on this wire. The retired `{ status: 'unavailable' }` shape
// was a FIFTH error shape that merely restated the HTTP status in the body, and it could only exist because
// `ApiExceptionFilter` had a response-passthrough branch — the branch was the defect.
//
// ⚠️ Retiring a PUBLISHED component was verified rather than assumed: every consumer of `/health/ready` (the ALB
// target group, ECS, and the sandbox deploy smoke) reads the STATUS, not the body.
