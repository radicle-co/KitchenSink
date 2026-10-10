/**
 * An override may only LOWER a declared limit (ADR-0053 §6). It exists for load tests, and one that could admit more
 * than the declared limit in any of the publisher's windows is refused at startup.
 *
 * An override of `requests'` per `W'` admits up to `requests' × ⌈W / W'⌉` calls in one declared window `W`, so it is
 * admitted only when its window is no longer and that product is no more than the declared requests.
 */
import { describe, expect, it } from 'vitest';

import { judgeLimitOverride, parseLimitOverrides } from '../limitOverride.js';

const USDA = { requests: 1000, windowSeconds: 3600 } as const;

describe('judgeLimitOverride', () => {
    it.each([
        ['the declared limit itself', { requests: 1000, windowSeconds: 3600 }],
        ['fewer requests in the same window', { requests: 10, windowSeconds: 3600 }],
        ['half the window, at half the requests', { requests: 500, windowSeconds: 1800 }],
        ['a window that does not divide evenly, at the most it may hold', { requests: 250, windowSeconds: 1000 }],
        ['16 a minute, which is 960 an hour', { requests: 16, windowSeconds: 60 }],
        // ⌊0.9 × 3⌋ = 2, and the worker's share of 2 is 1: the smallest override that still drains the queue.
        ['the fewest requests that leave the worker a share', { requests: 3, windowSeconds: 3600 }],
    ])('admits %s', (_, override) => {
        expect(judgeLimitOverride(USDA, override)).toEqual({ admitted: true });
    });

    it.each([
        ['more requests in the same window', { requests: 1001, windowSeconds: 3600 }, /more than/u],
        ['half the window, one request over half', { requests: 501, windowSeconds: 1800 }, /more than/u],
        // ⌈3600 / 1000⌉ = 4 windows, so 251 per 1000 s admits 1,004 in one hour.
        [
            'a window that does not divide evenly, one request over',
            { requests: 251, windowSeconds: 1000 },
            /more than/u,
        ],
        ['a longer window, even at fewer requests', { requests: 10, windowSeconds: 7200 }, /longer/u],
        ['zero requests', { requests: 0, windowSeconds: 3600 }, /positive whole/u],
        ['a fractional request count', { requests: 1.5, windowSeconds: 3600 }, /positive whole/u],
        ['a zero window', { requests: 10, windowSeconds: 0 }, /positive whole/u],
        ['a fractional window', { requests: 10, windowSeconds: 0.5 }, /positive whole/u],
        ['a count that is not a number', { requests: Number.NaN, windowSeconds: 3600 }, /positive whole/u],
        // ⌊0.9 × 2⌋ = 1, and the worker's share of 1 is 0: the queue would never drain, with no error anywhere.
        ['so few requests that the worker gets no share', { requests: 2, windowSeconds: 3600 }, /worker/u],
    ])('refuses %s, saying why', (_, override, reason) => {
        const verdict = judgeLimitOverride(USDA, override);

        expect(verdict.admitted).toBe(false);
        expect(verdict.admitted ? '' : verdict.reason).toMatch(reason);
    });
});

/**
 * `FOOD_SOURCE_LIMIT_OVERRIDES` (ADR-0053 §6): a JSON object keyed by register id. Every entry is judged against that
 * source's declared limit, so the startup refusal is the same rule the limiter applies.
 */
describe('parseLimitOverrides', () => {
    it('reads no overrides when the setting is absent or empty', () => {
        expect(parseLimitOverrides(undefined)).toEqual({ ok: true, overrides: {} });
        expect(parseLimitOverrides('')).toEqual({ ok: true, overrides: {} });
    });

    it('reads a lowering override for a callable source', () => {
        expect(parseLimitOverrides('{"usda":{"requests":15,"windowSeconds":60}}')).toEqual({
            ok: true,
            overrides: { usda: { requests: 15, windowSeconds: 60 } },
        });
    });

    it.each([
        [
            'an override that raises USDA',
            '{"usda":{"requests":1001,"windowSeconds":3600}}',
            /usda.*more than the declared 1000/u,
        ],
        ['a window longer than the declared one', '{"usda":{"requests":1,"windowSeconds":7200}}', /longer than/u],
        ['a file source', '{"ciqual":{"requests":1,"windowSeconds":60}}', /ciqual.*not a callable/u],
        // Neither can search, so both are file sources and nothing calls them (owner, 2026-10-01).
        [
            'Matvaretabellen, a file source',
            '{"matvaretabellen":{"requests":1,"windowSeconds":60}}',
            /matvaretabellen.*not a callable/u,
        ],
        [
            'Livsmedelsdatabasen, a file source',
            '{"livsmedelsverket":{"requests":1,"windowSeconds":60}}',
            /livsmedelsverket.*not a callable/u,
        ],
        ['an unknown key in an entry', '{"usda":{"requests":1,"windowSeconds":60,"burst":5}}', /usda/u],
        ['a fractional count', '{"usda":{"requests":1.5,"windowSeconds":60}}', /usda/u],
        ['text that is not JSON', 'usda=15', /JSON/u],
        ['a JSON value that is not an object', '[1]', /object/u],
    ])('refuses %s, naming why', (_, raw, reason) => {
        const parsed = parseLimitOverrides(raw);

        expect(parsed.ok).toBe(false);
        expect(parsed.ok ? '' : parsed.reason).toMatch(reason);
    });
});
