/**
 * Unit tests for the `@CallerBearerToken()` route-parameter decorator's resolver.
 *
 * Two properties matter, and the second is the security one:
 *  - a request carrying a bearer yields a {@link CallerToken} wrapping exactly that credential, so the token
 *    forwarded to the food service is the one this service verified;
 *  - a request with NO bearer yields `undefined` — NOT a throw, and never some other credential. The
 *    non-production dev-auth bypass authenticates with no token at all, and the ingredient typeahead must
 *    degrade honestly in that case rather than 500 or silently swap credentials.
 *
 * A direct controller method call does not run param decorators, so the resolver is exported and tested
 * here against a mock `ExecutionContext` — the same approach `current-principal.decorator.test.ts` uses.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';

import { CallerToken, revealCallerToken } from '../caller-token.js';
import { resolveCallerBearerToken } from '../caller-token.decorator.js';

const SECRET = 'eyJhbGciOiJSUzI1NiJ9.CALLER-SESSION-JWT.sIgNaTuRe';

/** A mock `ExecutionContext` whose request carries the given headers. */
function contextWithHeaders(headers: Record<string, string | undefined>): ExecutionContext {
    return {
        switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    } as unknown as ExecutionContext;
}

describe('resolveCallerBearerToken', () => {
    it('wraps the request bearer so it can be forwarded to the food service', () => {
        const resolved = resolveCallerBearerToken(undefined, contextWithHeaders({ authorization: `Bearer ${SECRET}` }));

        expect(resolved).toBeInstanceOf(CallerToken);
        expect(revealCallerToken(resolved as CallerToken)).toBe(SECRET);
    });

    it('returns undefined when the request carries no Authorization header (dev-auth bypass)', () => {
        expect(resolveCallerBearerToken(undefined, contextWithHeaders({}))).toBeUndefined();
    });

    it('returns undefined for a non-bearer scheme rather than forwarding an unusable credential', () => {
        expect(resolveCallerBearerToken(undefined, contextWithHeaders({ authorization: 'Basic abc' }))).toBeUndefined();
    });

    it('does not throw on a request with no principal — absence degrades, it is not an auth failure', () => {
        expect(() => resolveCallerBearerToken(undefined, contextWithHeaders({}))).not.toThrow();
    });
});
