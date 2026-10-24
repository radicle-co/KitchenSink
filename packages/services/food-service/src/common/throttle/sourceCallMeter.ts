/**
 * The source calls one request had admitted against the shared window, counted where the window is charged, so the
 * requester source budget refunds exactly the calls the request did not make (`requesterSourceBudget.interceptor.ts`).
 *
 * The count is taken at admission because admission is the one place a source call is charged (ADR-0053 §3): every
 * request to a source goes through the rate-limited transport, and a call it admits has spent the window whether the
 * source then answers, fails or times out. Counting there needs no knowledge of which handler outcome made a call,
 * so a body the pipe refuses, a busy source and a source `429` are each counted by what actually happened.
 * `meteredAdmission.ts` does the counting.
 *
 * The meter travels with the request's async context, so the services between the interceptor and the transport do
 * not carry it. Only {@link SourceCallMeter.run} sets it.
 *
 * @pattern Ambient Context — one meter per request, carried by an `AsyncLocalStorage` private to this module
 * @module
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { Admission } from '../../sources/transport/transportPorts.js';
import { SourceCallMeterSealedError } from './sourceCallMeter.errors.js';

/** The meter of the request whose async context is running, if any. */
const currentMeter = new AsyncLocalStorage<SourceCallMeter>();

/** One request's count of admitted source calls. */
export class SourceCallMeter {
    private admitted = 0;
    private inFlight = 0;
    private usedAtSeal: number | undefined;

    /**
     * The meter of the request whose async context is running.
     *
     * @returns The meter, or `undefined` outside a metered request.
     */
    public static current(): SourceCallMeter | undefined {
        return currentMeter.getStore();
    }

    /**
     * Run a request's work with this meter as its context.
     *
     * @param work - The work. Its own async continuations inherit the meter.
     * @returns What the work returns.
     * @sideEffect Whatever `work` does.
     */
    public async run<T>(work: () => Promise<T>): Promise<T> {
        return currentMeter.run(this, work);
    }

    /**
     * Stop counting, and report the calls the request used: those admitted, and those whose admission was still
     * being decided, which may yet be granted. Later admissions are refused. Idempotent.
     *
     * @returns The calls used.
     */
    public seal(): number {
        this.usedAtSeal ??= this.admitted + this.inFlight;

        return this.usedAtSeal;
    }

    /**
     * Count one admission while it is decided.
     *
     * @param decide - Asks the window.
     * @returns The window's answer.
     * @throws {SourceCallMeterSealedError} when the meter is sealed, before the window is asked.
     * @throws Whatever `decide` throws, unchanged.
     */
    public async count(decide: () => Promise<Admission>): Promise<Admission> {
        if (this.usedAtSeal !== undefined) {
            throw new SourceCallMeterSealedError();
        }

        this.inFlight += 1;

        try {
            const admission = await decide();

            if (admission.admitted) {
                this.admitted += 1;
            }

            return admission;
        } finally {
            this.inFlight -= 1;
        }
    }
}
