/**
 * Unit tests for {@link CallerToken} — the opaque, non-serializable holder for the CALLER's own Clerk
 * bearer, which the ingredients vertical forwards to the food service on the caller's behalf (issue #120).
 *
 * The contract here is almost entirely NEGATIVE, and that is the point: this suite exists to prove the
 * credential cannot leak by the routes credentials actually leak by — a template string in a log line, a
 * `JSON.stringify` of an error/response body, `util.inspect` in a debugger or crash dump, or an enumerable
 * property somebody spreads into a payload. The raw value is held OFF the object (a module-private
 * `WeakMap`), so those routes have nothing to find even before the redacting hooks.
 *
 * Written before the module existed (TDD red → green).
 */
import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { CallerToken, revealCallerToken } from '../caller-token.js';

/** A stand-in for a real Clerk session JWT — deliberately distinctive so a leak is unmistakable. */
const SECRET = 'eyJhbGciOiJSUzI1NiJ9.CALLER-SESSION-JWT-DO-NOT-LOG.sIgNaTuRe';

/** Build a token from a well-formed header (the only sanctioned construction path). */
function token(): CallerToken {
    const created = CallerToken.fromAuthorizationHeader(`Bearer ${SECRET}`);

    if (created === undefined) {
        throw new Error('fixture: expected a CallerToken');
    }

    return created;
}

describe('CallerToken.fromAuthorizationHeader', () => {
    it('accepts a well-formed bearer header and carries the exact token', () => {
        expect(revealCallerToken(token())).toBe(SECRET);
    });

    it('is case-insensitive on the scheme and trims the credential (one shared bearer parse)', () => {
        const lower = CallerToken.fromAuthorizationHeader(`bearer   ${SECRET}  `);

        expect(lower).toBeInstanceOf(CallerToken);
        expect(revealCallerToken(lower as CallerToken)).toBe(SECRET);
    });

    it.each([
        ['absent', undefined],
        ['empty', ''],
        ['whitespace', '   '],
        ['scheme only', 'Bearer'],
        ['scheme with no credential', 'Bearer    '],
        ['a different scheme', `Basic ${SECRET}`],
    ])('returns undefined for %s authorization (no credential to forward)', (_label, header) => {
        expect(CallerToken.fromAuthorizationHeader(header)).toBeUndefined();
    });
});

describe('CallerToken redaction — the credential must not be reachable by any leak route', () => {
    it('renders as [REDACTED] in a template string (the log-line leak)', () => {
        expect(`token=${token()}`).toBe('token=[REDACTED]');
    });

    it('renders as [REDACTED] via String() and .toString()', () => {
        expect(String(token())).toBe('[REDACTED]');
        expect(token().toString()).toBe('[REDACTED]');
    });

    it('serializes to [REDACTED] through JSON.stringify (the response/error-body leak)', () => {
        expect(JSON.stringify({ caller: token() })).toBe('{"caller":"[REDACTED]"}');
        expect(JSON.stringify(token())).toBe('"[REDACTED]"');
    });

    it('renders as [REDACTED] through util.inspect at full depth (the debugger / crash-dump leak)', () => {
        expect(inspect(token(), { depth: null })).toBe('[REDACTED]');
        expect(inspect({ caller: token() }, { depth: null })).not.toContain(SECRET);
    });

    it('exposes NO property holding the credential — the raw value lives off the object', () => {
        const created = token();

        // Own keys, inherited keys, and a spread all come up empty: there is no field to find, so a
        // future `{...caller}` or Object.assign into a payload cannot carry the credential out.
        expect(Object.keys(created)).toEqual([]);
        expect(Object.getOwnPropertyNames(created)).toEqual([]);
        expect(JSON.stringify({ ...created })).toBe('{}');
        expect(Object.values(created)).toEqual([]);
    });

    it('does not leak through an Error built from it, however it is stringified', () => {
        const error = new Error(`food call failed for ${token()}`);

        expect(error.message).not.toContain(SECRET);
        expect(String(error)).not.toContain(SECRET);
        expect(inspect(error, { depth: null })).not.toContain(SECRET);
    });
});

describe('revealCallerToken', () => {
    it('returns the raw bearer for a token this module created (the ONE sanctioned accessor)', () => {
        expect(revealCallerToken(token())).toBe(SECRET);
    });

    it('keeps distinct callers distinct (no shared/ambient credential)', () => {
        const first = CallerToken.fromAuthorizationHeader('Bearer first-token');
        const second = CallerToken.fromAuthorizationHeader('Bearer second-token');

        expect(revealCallerToken(first as CallerToken)).toBe('first-token');
        expect(revealCallerToken(second as CallerToken)).toBe('second-token');
    });

    it('throws (never returns a blank credential) for an object that did not come from this module', () => {
        // A forged look-alike must not silently produce an unauthenticated call that looks authenticated.
        const forged = Object.create(CallerToken.prototype) as CallerToken;

        expect(() => revealCallerToken(forged)).toThrow(/CallerToken/);
    });

    it('does not name the credential in its failure message', () => {
        const forged = Object.create(CallerToken.prototype) as CallerToken;

        expect(() => revealCallerToken(forged)).not.toThrow(new RegExp(SECRET));
    });
});
