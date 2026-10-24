/**
 * The per-requester source budget (plan 002, the hourly cap owed before S6): PATCH resolve and the remote pick charge
 * the requester, before their handlers run, the source calls they can make, against one budget held in the database so
 * it binds across every API task; and refund, once the request ends, the calls it did not make.
 *
 * Nest runs every guard before any interceptor, so `UserThrottlerGuard`'s in-memory per-minute cap cuts a burst before
 * this reaches the database. Both are bound only through `throttle.decorators.ts`, which also sets the cost read here.
 *
 * - **Who is charged:** the requester key `resolveRequesterId` gives, never the token subject, so the account-erasure
 *   sweep can find the row. A user whose app id has not synced is deferred with `401 IDENTITY_SYNC_PENDING`, as
 *   add-by-name defers it.
 * - **Refused:** {@link RequesterLimitReachedError}, the same `429 REQUESTER_LIMIT_REACHED` the per-minute cap
 *   answers, with the seconds until the window ends.
 * - **The store fails:** `503 FETCH_UNAVAILABLE` with a wait. Fail closed: a request is never admitted uncounted.
 * - **The refund:** the calls the request's meter did not see admitted (`sourceCallMeter.ts`), given back to the window
 *   the charge landed in, once, after the handler's outcome and before the response. A refund that fails is logged and
 *   the response stands: the budget then over-counts, which is the safe direction.
 *
 * @pattern Around advice — reserve before the handler, settle after it, the receipt kept in one scope
 * @pattern Policy — whether a request's source calls fit its requester's budget, over the store that records them
 * @module
 */
import {
    Inject,
    Injectable,
    Logger,
    UnauthorizedException,
    type CallHandler,
    type ExecutionContext,
    type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { defer, lastValueFrom, type Observable } from 'rxjs';

import {
    IDENTITY_SYNC_PENDING_CODE,
    resolveRequesterId,
    type AuthenticatedRequest,
} from '../../auth/authenticatedPrincipal.js';
import {
    checkedBudgetCharge,
    RequesterSourceBudgetDao,
    type BudgetCharge,
    type BudgetChargeInput,
    type BudgetReceipt,
} from '../../foods/dao/requesterSourceBudget.dao.js';
import { FetchUnavailableError, RequesterLimitReachedError } from '../../foods/foods.errors.js';
import { apiError } from '../apiError.js';
import { SOURCE_CALL_COST_METADATA, type SourceCallCost } from './sourceCallCost.js';
import { SourceCallMeter } from './sourceCallMeter.js';
import {
    REQUESTER_SOURCE_BUDGET_PER_HOUR,
    REQUESTER_SOURCE_BUDGET_RETRY_SECONDS,
    REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS,
} from './throttle.config.js';

/**
 * The requester key a request is charged to. Pure.
 *
 * @param req - The request `FoodAuthGuard` authenticated.
 * @returns The app-user ULID, or the `svc_*` id.
 * @throws {UnauthorizedException} (→ 401) when no principal is attached, which no budgeted route admits.
 * @throws (→ 401 `IDENTITY_SYNC_PENDING`) when a user token carries no app id yet.
 */
function requesterOf(req: AuthenticatedRequest): string {
    if (req.user === undefined) {
        throw new UnauthorizedException('Valid Clerk session or M2M token required');
    }

    const resolution = resolveRequesterId(req.user);

    if (resolution.status === IDENTITY_SYNC_PENDING_CODE) {
        throw apiError(
            IDENTITY_SYNC_PENDING_CODE,
            'App-user identity (external_id) not yet available; retry with a refreshed token.',
        );
    }

    return resolution.requesterId;
}

@Injectable()
export class RequesterSourceBudgetInterceptor implements NestInterceptor {
    private readonly logger = new Logger(RequesterSourceBudgetInterceptor.name);

    /**
     * @param reflector - Reads the cost the route's decorator set.
     * @param budget - The store every API task charges and refunds.
     */
    public constructor(
        private readonly reflector: Reflector,
        @Inject(RequesterSourceBudgetDao) private readonly budget: Pick<RequesterSourceBudgetDao, 'charge' | 'refund'>,
    ) {}

    /**
     * Charge the request's source calls to its requester, run the handler only when the budget holds them, then refund
     * the calls it did not make.
     *
     * @param context - The request's execution context.
     * @param next - The handler, with the pipes before it.
     * @returns The handler's answer.
     * @throws {Error} when the route carries this interceptor with no cost, which is a wiring bug.
     * @throws {RangeError} when the cost is not one the store can record, which is a wiring bug too, never a `503`.
     * @throws (→ 401) the {@link requesterOf} cases, before any charge.
     * @throws {RequesterLimitReachedError} (→ 429, with `Retry-After`) when the budget cannot hold the charge.
     * @throws {FetchUnavailableError} (→ 503, with `Retry-After`) when the budget cannot be read.
     * @sideEffect Charges and may refund `requester_source_budget`; runs the handler.
     */
    public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        return defer(async () => this.around(context, next));
    }

    /**
     * @see {@link intercept}
     * @sideEffect Charges and may refund `requester_source_budget`; runs the handler.
     */
    private async around(context: ExecutionContext, next: CallHandler): Promise<unknown> {
        const cost = this.reflector.get<SourceCallCost | undefined>(SOURCE_CALL_COST_METADATA, context.getHandler());

        if (cost === undefined) {
            throw new Error(`${context.getHandler().name} carries the source budget with no source-call cost.`);
        }

        const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
        // Checked before the store is asked, so a cost the store cannot record surfaces as the bug it is.
        const charge = checkedBudgetCharge({
            requesterId: requesterOf(req),
            cost: cost(req.body),
            limit: REQUESTER_SOURCE_BUDGET_PER_HOUR,
            windowSeconds: REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS,
        });
        const verdict = await this.chargeOrBusy(charge);

        if (!verdict.admitted) {
            throw new RequesterLimitReachedError(verdict.retryAfterSeconds);
        }

        const meter = new SourceCallMeter();

        try {
            // Subscribed inside the meter's run, so the pipes and the handler run in its context.
            return await meter.run(async () => lastValueFrom(next.handle(), { defaultValue: undefined }));
        } finally {
            await this.refundUnused(verdict.receipt, meter.seal());
        }
    }

    /**
     * Charge the budget, turning a store failure, and only that, into a busy refusal.
     *
     * @param charge - The checked charge.
     * @returns The store's verdict.
     * @throws {FetchUnavailableError} when the store fails.
     * @sideEffect Charges `requester_source_budget`; logs a store failure.
     */
    private async chargeOrBusy(charge: BudgetChargeInput): Promise<BudgetCharge> {
        try {
            return await this.budget.charge(charge);
        } catch (error) {
            // Our own store failed: logged as ours, and the caller is told to come back rather than admitted uncounted.
            this.logger.error('source-budget-unavailable', { cause: String(error) });

            throw new FetchUnavailableError(REQUESTER_SOURCE_BUDGET_RETRY_SECONDS, 'Source budget unavailable');
        }
    }

    /**
     * Give back the calls a request was charged for and did not make. Never throws: the request's own outcome stands.
     *
     * @param receipt - What the charge recorded.
     * @param used - The calls the request's meter saw admitted, or still being admitted, when it was sealed.
     * @sideEffect Refunds `requester_source_budget`; logs a refund failure or a charge smaller than the calls made.
     */
    private async refundUnused(receipt: BudgetReceipt, used: number): Promise<void> {
        if (used > receipt.cost) {
            // The cost model under-charged this route: nothing to refund, and the cost is what needs fixing.
            this.logger.warn('source-budget-under-charged', { cost: receipt.cost, used });

            return;
        }

        if (used === receipt.cost) {
            return;
        }

        try {
            await this.budget.refund(receipt, receipt.cost - used);
        } catch (error) {
            this.logger.error('source-budget-refund-failed', { cause: String(error) });
        }
    }
}
