/**
 * Unit tests for {@link readRateLimitHeaders} — the pure reader for USDA's `X-RateLimit-*` response
 * headers (U38).
 *
 * The point of reading them is that they SETTLE, empirically, whether the 1,000/hr quota is charged
 * per API key or per egress IP — a question our rolling-window counter can only model. So the reader
 * must be honest about absence: a header USDA did not send is `undefined`, never a fabricated `0`,
 * because a fabricated `0` reads on a chart exactly like an exhausted quota.
 */
import { describe, expect, it } from 'vitest';

import { readRateLimitHeaders } from '../rateLimit.js';

/** Build a `Headers` from a plain record (mirrors what `fetch` hands back). */
function headersOf(entries: Record<string, string>): Headers {
    return new Headers(entries);
}

describe('readRateLimitHeaders', () => {
    it('reads both X-RateLimit-Limit and X-RateLimit-Remaining', () => {
        const snapshot = readRateLimitHeaders(
            headersOf({ 'X-RateLimit-Limit': '1000', 'X-RateLimit-Remaining': '997' }),
        );

        expect(snapshot).toEqual({ limit: 1000, remaining: 997 });
    });

    it('is case-insensitive on the header names (HTTP/2 lowercases them)', () => {
        const snapshot = readRateLimitHeaders(headersOf({ 'x-ratelimit-limit': '1000', 'x-ratelimit-remaining': '0' }));

        expect(snapshot).toEqual({ limit: 1000, remaining: 0 });
    });

    it('keeps a remaining of 0 (an exhausted quota is a reading, not an absence)', () => {
        const snapshot = readRateLimitHeaders(headersOf({ 'X-RateLimit-Remaining': '0' }));

        expect(snapshot).toEqual({ remaining: 0 });
    });

    it('reports only the header that is present', () => {
        expect(readRateLimitHeaders(headersOf({ 'X-RateLimit-Remaining': '42' }))).toEqual({ remaining: 42 });
        expect(readRateLimitHeaders(headersOf({ 'X-RateLimit-Limit': '3600' }))).toEqual({ limit: 3600 });
    });

    it('returns undefined when USDA sent neither header (absence is not an error)', () => {
        expect(readRateLimitHeaders(headersOf({ 'content-type': 'application/json' }))).toBeUndefined();
    });

    it('returns undefined when there are no headers at all', () => {
        expect(readRateLimitHeaders(undefined)).toBeUndefined();
    });

    it('drops a value that is not a non-negative integer rather than reporting NaN', () => {
        expect(readRateLimitHeaders(headersOf({ 'X-RateLimit-Remaining': 'unlimited' }))).toBeUndefined();
        expect(readRateLimitHeaders(headersOf({ 'X-RateLimit-Remaining': '' }))).toBeUndefined();
        expect(readRateLimitHeaders(headersOf({ 'X-RateLimit-Remaining': '-1' }))).toBeUndefined();
        expect(readRateLimitHeaders(headersOf({ 'X-RateLimit-Remaining': '12.5' }))).toBeUndefined();
        expect(readRateLimitHeaders(headersOf({ 'X-RateLimit-Remaining': '1e3' }))).toBeUndefined();
    });

    it('drops only the malformed half of a pair', () => {
        const snapshot = readRateLimitHeaders(headersOf({ 'X-RateLimit-Limit': 'n/a', 'X-RateLimit-Remaining': '5' }));

        expect(snapshot).toEqual({ remaining: 5 });
    });

    it('tolerates surrounding whitespace', () => {
        expect(readRateLimitHeaders(headersOf({ 'X-RateLimit-Remaining': ' 7 ' }))).toEqual({ remaining: 7 });
    });
});
