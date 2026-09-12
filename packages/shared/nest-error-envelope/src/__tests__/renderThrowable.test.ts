import { describe, expect, it } from 'vitest';

import { renderThrowable } from '../renderThrowable.js';

/** The shape `pg` raises: an `Error` carrying SQLSTATE fields as own properties. */
function pgError(message: string, code: string): Error {
    return Object.assign(new Error(message), { code, severity: 'FATAL' });
}

describe('renderThrowable', () => {
    it('includes the CAUSE, which a bare `.stack` never does', () => {
        // The shape behind the 2026-09-11 k6 500s: drizzle wraps the driver error as `cause`, and the log line
        // said only "Failed query" because `Error.prototype.stack` is the outer error's alone.
        const driver = pgError('terminating connection due to administrator command', '57P01');
        const wrapped = new Error('Failed query: select 1', { cause: driver });

        const rendered = renderThrowable(wrapped);

        expect(wrapped.stack).not.toContain('terminating connection');
        expect(rendered).toContain('Failed query: select 1');
        expect(rendered).toContain('terminating connection due to administrator command');
        expect(rendered).toContain('57P01');
    });

    it('follows a cause chain more than one level deep', () => {
        const root = pgError('password authentication failed', '28P01');
        const middle = new Error('connect failed', { cause: root });
        const outer = new Error('Failed query', { cause: middle });

        const rendered = renderThrowable(outer);

        expect(rendered).toContain('connect failed');
        expect(rendered).toContain('password authentication failed');
        expect(rendered).toContain('28P01');
    });

    it('terminates on a cyclic cause', () => {
        const a = new Error('a');
        const b = new Error('b', { cause: a });

        Object.assign(a, { cause: b });

        expect(renderThrowable(a)).toContain('a');
    });

    it('renders a thrown non-Error as its string form', () => {
        expect(renderThrowable('plain string')).toBe('plain string');
        expect(renderThrowable(42)).toBe('42');
    });
});
