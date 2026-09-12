/**
 * Whether a per-source limit override may replace a declared limit (ADR-0053 §6). An override exists for load tests
 * and may only lower a limit: one that could admit more calls than the declared limit in one of the publisher's own
 * windows is refused at startup, so no setting can push our traffic past what the publisher allows.
 *
 * @pattern Specification — a pure verdict, which the environment schema turns into a startup refusal
 * @module
 */
import { z } from 'zod';

import { apiAccessOf, isCallableApiSourceId, type CallableApiSourceId } from '../sourceRegister.js';

/** A number of requests in a rolling window of seconds. */
export interface WindowLimit {
    readonly requests: number;
    readonly windowSeconds: number;
}

/** Whether an override is admitted, and when it is not, why. */
export type OverrideVerdict = { readonly admitted: true } | { readonly admitted: false; readonly reason: string };

/**
 * Whether a value is a whole number above zero. Pure.
 *
 * @param value - The value.
 * @returns True for 1, 2, 3, …
 */
function isPositiveWhole(value: number): boolean {
    return Number.isInteger(value) && value > 0;
}

/**
 * Judge an override against the limit it would replace. Pure.
 *
 * An override of `requests'` per `W'` admits up to `requests' × ⌈W / W'⌉` calls in one declared window `W`, so it is
 * admitted only when `W' ≤ W` and that product is at most the declared requests. Its 90% ceiling then admits no more
 * than the declared limit's.
 *
 * @param declared - The register's limit.
 * @param override - The proposed limit.
 * @returns The verdict.
 */
export function judgeLimitOverride(declared: WindowLimit, override: WindowLimit): OverrideVerdict {
    if (!isPositiveWhole(override.requests) || !isPositiveWhole(override.windowSeconds)) {
        return { admitted: false, reason: 'requests and windowSeconds must each be a positive whole number' };
    }

    if (override.windowSeconds > declared.windowSeconds) {
        return {
            admitted: false,
            reason: `a ${String(override.windowSeconds)} s window is longer than the declared ${String(declared.windowSeconds)} s`,
        };
    }

    const perDeclaredWindow = override.requests * Math.ceil(declared.windowSeconds / override.windowSeconds);

    if (perDeclaredWindow > declared.requests) {
        return {
            admitted: false,
            reason: `${String(override.requests)} per ${String(override.windowSeconds)} s admits up to ${String(perDeclaredWindow)} per ${String(declared.windowSeconds)} s, more than the declared ${String(declared.requests)}`,
        };
    }

    return { admitted: true };
}

/** Each callable source's override, when it has one. */
export type SourceLimitOverrides = Readonly<Partial<Record<CallableApiSourceId, WindowLimit>>>;

/** What reading the override setting gives: the overrides, or why the setting is refused. */
export type ParsedLimitOverrides =
    { readonly ok: true; readonly overrides: SourceLimitOverrides } | { readonly ok: false; readonly reason: string };

const windowLimitSchema = z.strictObject({
    requests: z.number(),
    windowSeconds: z.number(),
});

/**
 * Read `FOOD_SOURCE_LIMIT_OVERRIDES`: a JSON object keyed by callable source id, each value
 * `{ "requests": n, "windowSeconds": s }`. Every entry is judged against its source's declared limit, so one that
 * would raise a limit refuses the whole setting. Pure.
 *
 * @param raw - The setting's text, or `undefined` when unset.
 * @returns The overrides (none for an unset or empty setting), or the first reason it is refused.
 */
export function parseLimitOverrides(raw: string | undefined): ParsedLimitOverrides {
    if (raw === undefined || raw.trim() === '') {
        return { ok: true, overrides: {} };
    }

    let value: unknown;

    try {
        value = JSON.parse(raw);
    } catch {
        return { ok: false, reason: 'must be JSON' };
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { ok: false, reason: 'must be a JSON object keyed by source id' };
    }

    const overrides: [CallableApiSourceId, WindowLimit][] = [];

    for (const [key, entry] of Object.entries(value)) {
        if (!isCallableApiSourceId(key)) {
            return { ok: false, reason: `${key} is not a callable source` };
        }

        const limit = windowLimitSchema.safeParse(entry);

        if (!limit.success) {
            return { ok: false, reason: `${key}: must be { "requests": n, "windowSeconds": s } and nothing else` };
        }

        const verdict = judgeLimitOverride(apiAccessOf(key).rateLimit, limit.data);

        if (!verdict.admitted) {
            return { ok: false, reason: `${key}: ${verdict.reason}` };
        }

        overrides.push([key, limit.data]);
    }

    return { ok: true, overrides: Object.fromEntries(overrides) };
}
