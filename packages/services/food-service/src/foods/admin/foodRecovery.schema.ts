/**
 * THE OPERATOR-RECOVERY WIRE CONTRACT for `POST /api/v1/foods/admin/foods/{id}/requeue` (U9) — authored here
 * and copied into `@kitchensink/schema-food` (`docs/CODING_STANDARDS.md` §15.2).
 *
 * The response was a hand-written `interface` on the service until this file existed, which left the route
 * invisible to the schema package, to `openapi.yaml` and to `oasdiff` — the §15.2 breach, not a style point.
 *
 * Admin-scoped: the route requires the `food:admin` scope from the verified token's `public_metadata` (`403`
 * otherwise, FR-039/FR-051). It resets operational state, never per-user data.
 */
import { z } from 'zod';

/**
 * Body for `POST /api/v1/foods/admin/foods/{id}/requeue` — the acknowledgement of an operator requeue.
 *
 * `status` is the LITERAL `PENDING`, not the lifecycle enum: a successful requeue has exactly one outcome,
 * and publishing the whole enum would describe states this route cannot return. Widening it later is
 * additive; narrowing it would be a breaking change, so it starts narrow.
 */
export const requeueResponseSchema = z.object({
    /** The requeued food (ingredient) id. */
    id: z.string(),
    /** Its lifecycle status after the requeue. */
    status: z.literal('PENDING'),
});

export type RequeueResponse = z.infer<typeof requeueResponseSchema>;
