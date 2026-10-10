/**
 * The passthrough registry and the cache-partition header name (ADR-0020): the two facts the Lambda@Edge handler and
 * `EdgeStack` both read from `edgeRoutes.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
    EDGE_PRINCIPAL_HEADER,
    PASSTHROUGH_PATH_PATTERNS,
    isPassthroughRequest,
    matchesPathPattern,
} from '../edgeRoutes.js';

describe('the passthrough registry is ONE authority, matched the way CloudFront matches it', () => {
    it('lists exactly the three exemptions ADR-0020 records', () => {
        // Pinned, not merely tested through: each entry is a decision with a recorded reason, and a fourth
        // appearing without one is how an unauthenticated hole gets added to a public edge.
        expect([...PASSTHROUGH_PATH_PATTERNS]).toEqual(['/health*', '/api/v1/internal/*', '/v1/internal/*']);
    });

    it.each([
        ['/health*', '/health', true],
        ['/health*', '/health/ready', true],
        ['/health*', '/api/v1/recipes', false],
        ['/api/v1/internal/*', '/api/v1/internal/account/erasure', true],
        ['/api/v1/internal/*', '/api/v1/internally-public', false],
        ['/api/v1/recipes', '/api/v1/recipes', true],
        ['/api/v1/recipes', '/api/v1/recipes/1', false],
    ])('matches pattern %s against %s → %s', (pattern, uri, expected) => {
        expect(matchesPathPattern(pattern, uri)).toBe(expected);
    });

    it('does not exempt a path that merely CONTAINS an exempt prefix', () => {
        expect(isPassthroughRequest({ method: 'GET', uri: '/api/v1/recipes/health' })).toBe(false);
        expect(isPassthroughRequest({ method: 'POST', uri: '/api/v1/recipes/../internal/account/erasure' })).toBe(
            false,
        );
    });

    it('exempts OPTIONS regardless of path, because a preflight can precede any route', () => {
        expect(isPassthroughRequest({ method: 'OPTIONS', uri: '/api/v1/recipes/abc' })).toBe(true);
    });
});

/**
 * ⛔ THE ACCEPTANCE CRITERION for the cache-partition header's NAME — pinned because a real production
 * deploy rejected the first one.
 *
 * `EDGE_PRINCIPAL_HEADER` was `x-edge-principal`, and creating the cache policy failed outright:
 *
 *     AWS::CloudFront::CachePolicy: The parameter Headers contains x-edge-principal that is not allowed.
 *     (Service: CloudFront, Status Code: 400)
 *
 * **`X-Edge-*` is CloudFront's own reserved namespace** — it is where CloudFront puts its internal request
 * metadata — so a cache policy refuses to key on one. Nothing local catches this: the header is a plain
 * string, the synth is valid CloudFormation, and every unit and synth assertion passed. It surfaced only
 * when CloudFront itself validated the resource, which is why the name is now asserted rather than assumed.
 *
 * The rename is safe by construction: `grep` finds no consumer of this header in ANY service — it is a
 * cache partition token, never an identity assertion, and the verifier strips any client-supplied copy
 * before use.
 */
describe('the cache-partition header name', () => {
    it('⛔ avoids CloudFront`s reserved X-Edge-* namespace, which a cache policy rejects', () => {
        expect(EDGE_PRINCIPAL_HEADER.toLowerCase().startsWith('x-edge-')).toBe(false);
    });

    it('⛔ avoids every namespace CloudFront reserves or manages', () => {
        // `x-amz-cf-*` and `x-amzn-*` are AWS's; `cloudfront-*` are the viewer headers CloudFront injects.
        for (const reserved of ['x-edge-', 'x-amz-cf-', 'x-amzn-', 'cloudfront-']) {
            expect(EDGE_PRINCIPAL_HEADER.toLowerCase().startsWith(reserved), `reserved prefix ${reserved}`).toBe(false);
        }
    });

    it('is a lower-case custom header, so the cache key and the origin agree on it', () => {
        expect(EDGE_PRINCIPAL_HEADER).toBe(EDGE_PRINCIPAL_HEADER.toLowerCase());
        expect(EDGE_PRINCIPAL_HEADER).toMatch(/^x-[a-z0-9-]+$/);
    });
});
