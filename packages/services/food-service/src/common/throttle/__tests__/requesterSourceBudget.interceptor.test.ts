/**
 * The per-requester source budget's interceptor: who a request is charged to, what it is charged, what each verdict
 * answers, and what is refunded once the request ends. The store is a double; the meter and its admission decorator
 * are real, so a handler double "makes" a source call the way the transport does, by being admitted.
 *
 * The wiring through Nest, the filter and the envelope is `tests/requesterSourceBudget.integration.test.ts`, and the
 * store's own guarantees are `tests/e2e/requesterSourceBudget.e2e.test.ts`.
 *
 * Each refusal is pinned to its exact exception type, because only a STORE failure is a `503`: a 401 or the
 * requester's limit that came back as a 503 would tell recipe and the apps "busy" for a caller who must refresh a
 * token or wait out their own limit.
 *
 * @module
 */
import 'reflect-metadata';

import {
    HttpException,
    HttpStatus,
    Logger,
    SetMetadata,
    UnauthorizedException,
    type CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { defer, lastValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../../auth/authenticatedPrincipal.js';
import type {
    BudgetCharge,
    BudgetChargeInput,
    BudgetReceipt,
    BudgetRefund,
    BudgetWindow,
} from '../../../foods/dao/requesterSourceBudget.dao.js';
import { isFetchUnavailableError, isRequesterLimitReachedError } from '../../../foods/foods.errors.js';
import { RequesterSourceBudgetInterceptor } from '../requesterSourceBudget.interceptor.js';
import { SOURCE_CALL_COST_METADATA } from '../sourceCallCost.js';
import { MeteredAdmission } from '../meteredAdmission.js';
import {
    REQUESTER_SOURCE_BUDGET_PER_HOUR,
    REQUESTER_SOURCE_BUDGET_RETRY_SECONDS,
    REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS,
} from '../throttle.config.js';

const USER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const THREE_CALLS = (): number => 3;
const WINDOW = '2026-10-02T11:00:00.123457Z' as BudgetWindow;

/** A route class: a costed handler, a handler with no cost, and one whose cost no window can hold. */
class Routes {
    @SetMetadata(SOURCE_CALL_COST_METADATA, THREE_CALLS)
    public resolve(): void {}

    public uncosted(): void {}

    @SetMetadata(SOURCE_CALL_COST_METADATA, () => 0)
    public miscosted(): void {}
}

/** What one interceptor run observed. */
interface Run {
    readonly outcome: Promise<unknown>;
    readonly charge: ReturnType<typeof vi.fn>;
    readonly refund: ReturnType<typeof vi.fn>;
    readonly handled: ReturnType<typeof vi.fn>;
}

/** The admission the handler double's calls go through, admitting every one. */
const transport = new MeteredAdmission({ admit: async () => ({ admitted: true }) });

/**
 * Run the interceptor once over a request whose handler makes `calls` source calls, then answers or throws.
 *
 * @param options - The principal, the handler, the store's answers, and what the handler does.
 * @returns The outcome and the doubles.
 */
function runInterceptor(options: {
    readonly user?: Partial<AuthenticatedPrincipal>;
    readonly handler?: 'resolve' | 'uncosted' | 'miscosted';
    readonly answer?: BudgetCharge | Error;
    readonly refundAnswer?: BudgetRefund | Error;
    readonly calls?: number;
    readonly handlerError?: Error;
}): Run {
    const answer = options.answer ?? {
        admitted: true,
        receipt: { requesterId: USER_ULID, cost: 3, window: WINDOW },
    };
    const charge = vi.fn(async (_input: BudgetChargeInput): Promise<BudgetCharge> => {
        if (answer instanceof Error) {
            throw answer;
        }

        return answer;
    });
    const refund = vi.fn(async (_receipt: BudgetReceipt, _calls: number): Promise<BudgetRefund> => {
        const refundAnswer = options.refundAnswer ?? 'refunded';

        if (refundAnswer instanceof Error) {
            throw refundAnswer;
        }

        return refundAnswer;
    });
    const handled = vi.fn(async (): Promise<string> => {
        for (let call = 0; call < (options.calls ?? 0); call += 1) {
            await transport.admit('usda', 'interactive');
        }

        if (options.handlerError !== undefined) {
            throw options.handlerError;
        }

        return 'handled';
    });
    const next: CallHandler = { handle: () => defer(handled) };
    const request = { user: 'user' in options ? options.user : COOK, body: undefined };
    const context = new ExecutionContextHost([request, {}], Routes, Routes.prototype[options.handler ?? 'resolve']);
    const interceptor = new RequesterSourceBudgetInterceptor(new Reflector(), { charge, refund });

    return { outcome: lastValueFrom(interceptor.intercept(context, next)), charge, refund, handled };
}

/** A synced cook. */
const COOK: Partial<AuthenticatedPrincipal> = { sub: 'user_cook', userId: USER_ULID, scopes: [], permissions: [] };

afterEach(() => {
    vi.restoreAllMocks();
});

describe('RequesterSourceBudgetInterceptor — the charge', () => {
    it('charges the requester the source calls the request can make, then runs the handler', async () => {
        const run = runInterceptor({ calls: 3 });

        await expect(run.outcome).resolves.toBe('handled');
        expect(run.charge).toHaveBeenCalledExactlyOnceWith({
            requesterId: USER_ULID,
            cost: 3,
            limit: REQUESTER_SOURCE_BUDGET_PER_HOUR,
            windowSeconds: REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS,
        });
        expect(run.handled).toHaveBeenCalledOnce();
    });

    it("refuses an exhausted budget with the requester's limit error and its window, before the handler", async () => {
        const run = runInterceptor({ answer: { admitted: false, retryAfterSeconds: 1234 } });
        const failure: unknown = await run.outcome.catch((error: unknown) => error);

        expect(isRequesterLimitReachedError(failure)).toBe(true);
        expect(isRequesterLimitReachedError(failure) && failure.retryAfterSeconds).toBe(1234);
        expect(run.handled).not.toHaveBeenCalled();
        expect(run.refund).not.toHaveBeenCalled();
    });

    it('fails closed with a retryable 503 when the budget cannot be read, before the handler', async () => {
        const run = runInterceptor({ answer: new Error('connection terminated') });
        const failure: unknown = await run.outcome.catch((error: unknown) => error);

        expect(isFetchUnavailableError(failure)).toBe(true);
        expect(isFetchUnavailableError(failure) && failure.retryAfterSeconds).toBe(
            REQUESTER_SOURCE_BUDGET_RETRY_SECONDS,
        );
        expect(run.handled).not.toHaveBeenCalled();
        expect(run.refund).not.toHaveBeenCalled();
    });

    // A cost no window can record is a wiring bug: it must surface as one, never as "busy".
    it('answers a charge the store cannot record as the wiring bug it is, not a 503, and charges nothing', async () => {
        const run = runInterceptor({ handler: 'miscosted' });
        const failure: unknown = await run.outcome.catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(RangeError);
        expect(isFetchUnavailableError(failure)).toBe(false);
        expect(run.charge).not.toHaveBeenCalled();
        expect(run.handled).not.toHaveBeenCalled();
    });

    it('charges a service principal under its own id', async () => {
        const run = runInterceptor({ user: { sub: 'svc_recipe', scopes: [], permissions: [] }, calls: 3 });

        await expect(run.outcome).resolves.toBe('handled');
        expect(run.charge).toHaveBeenCalledWith(expect.objectContaining({ requesterId: 'svc_recipe' }));
    });

    // A user token whose app id has not synced has no key the erasure sweep can find. It defers as add-by-name does.
    it('defers an unsynced user with 401 IDENTITY_SYNC_PENDING and charges nothing', async () => {
        const run = runInterceptor({ user: { sub: 'user_unsynced', scopes: [], permissions: [] } });
        const failure: unknown = await run.outcome.catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(HttpException);
        expect(failure instanceof HttpException && failure.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        expect(failure instanceof HttpException && failure.getResponse()).toMatchObject({
            code: 'IDENTITY_SYNC_PENDING',
        });
        expect(run.charge).not.toHaveBeenCalled();
    });

    it('refuses a request with no principal, which no budgeted route admits, and charges nothing', async () => {
        const run = runInterceptor({ user: undefined });

        await expect(run.outcome).rejects.toBeInstanceOf(UnauthorizedException);
        expect(run.charge).not.toHaveBeenCalled();
    });

    it('throws on a route that carries the budget with no cost, rather than charging a guess', async () => {
        const run = runInterceptor({ handler: 'uncosted' });

        await expect(run.outcome).rejects.toThrow(/uncosted/u);
        expect(run.charge).not.toHaveBeenCalled();
    });
});

describe('RequesterSourceBudgetInterceptor — the refund of calls not made', () => {
    it('refunds nothing when the handler made every call it was charged for', async () => {
        const run = runInterceptor({ calls: 3 });

        await run.outcome;

        expect(run.refund).not.toHaveBeenCalled();
    });

    it('refunds every call when the handler made none, and still answers what the handler answered', async () => {
        const run = runInterceptor({ calls: 0 });

        await expect(run.outcome).resolves.toBe('handled');
        expect(run.refund).toHaveBeenCalledExactlyOnceWith({ requesterId: USER_ULID, cost: 3, window: WINDOW }, 3);
    });

    it('refunds only the calls not made when the handler made some', async () => {
        const run = runInterceptor({ calls: 1 });

        await run.outcome;

        expect(run.refund).toHaveBeenCalledExactlyOnceWith(expect.anything(), 2);
    });

    // The 404, the 409, a busy source and a body the pipe refuses all reach the interceptor as a failed handler.
    it('refunds the calls not made when the handler fails, then passes on its failure unchanged', async () => {
        const notFound = new Error('no such food');
        const run = runInterceptor({ calls: 0, handlerError: notFound });

        await expect(run.outcome).rejects.toBe(notFound);
        expect(run.refund).toHaveBeenCalledExactlyOnceWith(expect.anything(), 3);
    });

    it('keeps the handler’s answer when the refund fails, and reports the failure as ours', async () => {
        const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        const run = runInterceptor({ calls: 0, refundAnswer: new Error('connection terminated') });

        await expect(run.outcome).resolves.toBe('handled');
        expect(logged).toHaveBeenCalledWith('source-budget-refund-failed', expect.anything());
    });

    it('refunds nothing, and warns, when the handler made more calls than it was charged for', async () => {
        const warned = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const run = runInterceptor({ calls: 4 });

        await run.outcome;

        expect(run.refund).not.toHaveBeenCalled();
        expect(warned).toHaveBeenCalledWith('source-budget-under-charged', { cost: 3, used: 4 });
    });
});
