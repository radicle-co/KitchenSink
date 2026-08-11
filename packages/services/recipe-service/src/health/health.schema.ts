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
    /** Always `ok` on a `200`; the `503` body says `unavailable` instead. */
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

/**
 * Body of `GET /health/ready` when the database is unreachable (`503`).
 *
 * Carries no `contractHash`: the fingerprint is not the question being answered, and a caller must not be able
 * to read a not-ready response as a contract assertion.
 */
export const healthUnavailableSchema = z.object({
    /** Always `unavailable`. */
    status: z.literal('unavailable'),
    /** Which service answered. */
    service: z.literal('recipe'),
});

/** An unavailable health payload. */
export type HealthUnavailable = z.infer<typeof healthUnavailableSchema>;
