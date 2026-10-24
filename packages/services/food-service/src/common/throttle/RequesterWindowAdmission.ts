/**
 * The admission a remote search miss passes (ADR-0055 point 6, review finding 5): the cook's hourly source budget
 * first, then the shared window, and the cook's call given back when the window refuses or fails. A cached answer
 * never reaches it, so a hit spends neither.
 *
 * The budget and the window are the ones resolve and the remote pick also charge (`requesterSourceBudget.dao.ts`,
 * `RollingWindowLimiter.ts`); this only orders them for one request's requester. It RETURNS a refusal, the cook's as
 * `requesterLimit`, because a refusal is that source's frame and never the whole answer; only a store failure throws,
 * and the transport reports it as its own.
 *
 * @pattern Decorator — over the window's `AdmissionPolicy`, adding the cook's budget first and a compensating refund
 * @module
 */
import { Logger } from '@nestjs/common';

import type { RequesterSourceBudgetDao } from '../../foods/dao/requesterSourceBudget.dao.js';
import type { CallableApiSourceId } from '../../sources/sourceRegister.js';
import type { Admission, AdmissionPolicy, SourceCallChannel } from '../../sources/transport/transportPorts.js';
import { REQUESTER_SOURCE_BUDGET_PER_HOUR, REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS } from './throttle.config.js';

/** The source calls one admitted miss spends: one request to one source. */
const CALLS_PER_MISS = 1;

/** Where a refund that failed is reported. Nest's `Logger` satisfies it. */
export interface AdmissionLogger {
    error(message: string, context?: Record<string, unknown>): void;
}

/** What the admission is built over. */
export interface RequesterWindowAdmissionDeps {
    /** The store every API task charges and refunds. */
    readonly budget: Pick<RequesterSourceBudgetDao, 'charge' | 'refund'>;
    /** The requester key `resolveRequesterId` gives, whose budget is charged. */
    readonly requesterId: string;
    /** The shared window: the limiter, in production. */
    readonly window: AdmissionPolicy;
    /** The current time, epoch milliseconds. Defaults to `Date.now`. */
    readonly now?: () => number;
    /** Defaults to a Nest `Logger`. */
    readonly logger?: AdmissionLogger;
}

export class RequesterWindowAdmission implements AdmissionPolicy {
    private readonly now: () => number;
    private readonly logger: AdmissionLogger;

    /** @param deps - The budget, the requester, the window, and optionally the clock and the logger. */
    public constructor(private readonly deps: RequesterWindowAdmissionDeps) {
        this.now = deps.now ?? Date.now;
        this.logger = deps.logger ?? new Logger(RequesterWindowAdmission.name);
    }

    /**
     * Charge the cook one call, then ask the shared window; give the call back when the window says no.
     *
     * @param source - The source to be called.
     * @param lane - The lane the window charges.
     * @returns Admitted, the cook's limit (`requesterLimit`, until the budget's window ends), or the window's refusal.
     * @throws The budget's failure, before the window is asked.
     * @throws The window's failure, after the cook's call is given back.
     * @sideEffect Charges, and may refund, `requester_source_budget`; charges the window when it admits.
     */
    public async admit(source: CallableApiSourceId, lane: SourceCallChannel): Promise<Admission> {
        const charge = await this.deps.budget.charge({
            requesterId: this.deps.requesterId,
            cost: CALLS_PER_MISS,
            limit: REQUESTER_SOURCE_BUDGET_PER_HOUR,
            windowSeconds: REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS,
        });

        if (!charge.admitted) {
            return {
                admitted: false,
                reason: 'requesterLimit',
                retryAt: new Date(this.now() + charge.retryAfterSeconds * 1_000).toISOString(),
            };
        }

        let admission: Admission;

        try {
            admission = await this.deps.window.admit(source, lane);
        } catch (error) {
            await this.refund(charge.receipt);

            throw error;
        }

        if (!admission.admitted) {
            await this.refund(charge.receipt);
        }

        return admission;
    }

    /**
     * Give the cook's call back. Never throws: the refusal or failure that caused it stands, and a budget that
     * over-counts is the safe direction.
     *
     * @param receipt - What the charge recorded.
     * @sideEffect Refunds `requester_source_budget`; logs a refund failure.
     */
    private async refund(receipt: Parameters<RequesterSourceBudgetDao['refund']>[0]): Promise<void> {
        try {
            await this.deps.budget.refund(receipt, CALLS_PER_MISS);
        } catch (error) {
            this.logger.error('source-budget-refund-failed', { cause: String(error) });
        }
    }
}
