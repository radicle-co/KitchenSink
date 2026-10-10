/**
 * What one request on a budgeted route charges the requester's source budget up front: the most source calls its
 * handler can make. Each cost reads the authority that decides the number, so a new resolve bound moves the charge
 * with it.
 *
 * A cost runs before the validation pipe, so it reads the raw body, and a body it cannot read is charged one call. The
 * calls a request does not make, a refused body's included, are refunded when it ends
 * (`requesterSourceBudget.interceptor.ts`); the per-minute cap, not the hourly budget, is what bounds a flood of them.
 *
 * @pattern Strategy — one cost rule per route, selected by the route's decorator
 * @module
 */
import { resolveFoodRequestSchema } from '../../foods/foods.schema.js';

/** The source calls a request can make, from its raw body. Pure. */
export type SourceCallCost = (body: unknown) => number;

/** The route metadata key holding a handler's {@link SourceCallCost}. */
export const SOURCE_CALL_COST_METADATA = 'food:sourceCallCost';

/** The charge for a request whose body cannot be read: one call. */
const UNREADABLE_BODY_COST = 1;

/**
 * A resolve fetches each pick from its source once (`FoodsService.patchResolve`). Pure.
 *
 * @param body - The raw request body.
 * @returns The number of picks, or one when the body is not a valid resolve.
 */
export const resolveCost: SourceCallCost = (body) => {
    const parsed = resolveFoodRequestSchema.safeParse(body);

    return parsed.success ? parsed.data.candidateIds.length : UNREADABLE_BODY_COST;
};

/**
 * A remote pick fetches its item once, and only when the catalog does not already stand for it
 * (`AdoptRemoteFood.execute`). Pure.
 *
 * @returns One call.
 */
export const adoptCost: SourceCallCost = () => 1;
