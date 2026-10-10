/**
 * The per-user throttler for food's capped routes (plan 002 S3, R42), mirroring recipe's `UserThrottlerGuard`.
 *
 * The stock `ThrottlerGuard` keys every counter on `req.ip`. Food runs behind the shared internet-facing ALB and does
 * not enable `trust proxy`, so `req.ip` is the ALB node's address for every caller: a cap keyed on it would be ONE
 * counter shared by every cook. This guard keys on the verified token subject instead.
 *
 * `FoodAuthGuard` is middleware, so it has run and attached `req.user` before any route guard. The fallback to the
 * ALB address is for a request with no principal, which no capped route admits today. It never reads
 * `X-Forwarded-For`: a caller can write that header, so trusting it would let them pick a fresh key per request.
 * Falling back to the ALB address instead puts every such caller in one bucket, which errs toward more throttling.
 *
 * ⚠️ A service principal (`svc_*`) is one subject, so every request a service makes on behalf of its callers shares
 * one bucket. No capped route is called that way today; one that is must decide that before it takes this guard.
 *
 * A refusal is the caller's own limit, so it is the same {@link RequesterLimitReachedError} the hourly source budget
 * raises (row editor item 10), not the stock throttler's exception, whose body carries no code of its own.
 *
 * @pattern Template Method — overrides the stock guard's `getTracker` and `throwThrottlingException` steps
 * @module
 */
import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

import { RequesterLimitReachedError } from '../../foods/foods.errors.js';

/**
 * The key a request counts against. Pure.
 *
 * Reads the request structurally rather than through `AuthenticatedRequest`, because the throttler hands the guard
 * a plain record, and a principal that is not exactly the verified shape is not trusted as one.
 *
 * @param req - The request, as the throttler passes it.
 * @returns `principal:<sub>` for a verified caller, else `ip:<address>`, else `ip:unknown`.
 */
export function throttleTrackerFor(req: Readonly<Record<string, unknown>>): string {
    const user = req['user'];
    const sub: unknown = typeof user === 'object' && user !== null ? Reflect.get(user, 'sub') : undefined;

    if (typeof sub === 'string' && sub.length > 0) {
        return `principal:${sub}`;
    }

    const ip = req['ip'];

    return `ip:${typeof ip === 'string' && ip.length > 0 ? ip : 'unknown'}`;
}

/** The throttler guard keyed per caller. Bound to a route only through `throttle.decorators.ts`. */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
    /**
     * Resolve the key a request counts against.
     *
     * @param req - The request, as the throttler passes it.
     * @returns The tracker from {@link throttleTrackerFor}.
     */
    protected override async getTracker(req: Record<string, unknown>): Promise<string> {
        return throttleTrackerFor(req);
    }

    /**
     * Refuse a caller over its limit.
     *
     * @param _context - The request's execution context.
     * @param detail - The throttler's record of the refusal; `timeToBlockExpire` is whole seconds, at least 1.
     * @throws {RequesterLimitReachedError} always, carrying the block's remaining seconds.
     */
    protected override async throwThrottlingException(
        _context: ExecutionContext,
        detail: ThrottlerLimitDetail,
    ): Promise<void> {
        throw new RequesterLimitReachedError(detail.timeToBlockExpire);
    }
}
