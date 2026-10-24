/**
 * The user-story walk's refusal checks (US1.4, US2.8) pass ONLY on the refusal the rule specifies — a `403` from the
 * service. A bare `catch` used to count a `500`, a timeout or a transport failure as a correct refusal, so the walk
 * printed ALL CHECKED SCENARIOS PASS while the authorization rule went untested.
 */
import { describe, expect, it } from 'vitest';
import {
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
    UnexpectedResponseError,
} from '@kitchensink/recipe-service-client';

import { attemptRefusal } from '../src/walkRefusal.js';

describe('attemptRefusal', () => {
    it('passes when the service answers 403', async () => {
        const outcome = await attemptRefusal(() => Promise.reject(new ForbiddenError('nope', 'NOT_OWNER')));

        expect(outcome.refused).toBe(true);
    });

    it('fails when the write was accepted', async () => {
        const outcome = await attemptRefusal(() => Promise.resolve({ id: 'r1' }));

        expect(outcome).toEqual({ refused: false, detail: 'the write was accepted' });
    });

    it.each([
        ['a 500', new UnexpectedResponseError(500)],
        ['a 401', new UnauthorizedError()],
        ['a 404', new NotFoundError()],
        ['a transport failure', new TypeError('fetch failed')],
    ])('fails on %s, which is not the refusal the rule specifies', async (_label, error) => {
        const outcome = await attemptRefusal(() => Promise.reject(error));

        expect(outcome.refused).toBe(false);
        expect(outcome.detail).toContain('not a 403');
    });
});
