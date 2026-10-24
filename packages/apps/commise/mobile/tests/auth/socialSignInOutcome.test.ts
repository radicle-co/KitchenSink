/**
 * What a finished native Google / Apple flow MEANS (plan 012 D5). `@clerk/expo@4.6.0`'s hooks answer
 * `{ createdSessionId: null, signIn, signUp }` for FOUR different things — the cook cancelled, Clerk was not loaded,
 * the sign-up stopped at `missing_requirements` (the required username), or a status the app cannot finish — so the
 * session id alone decides nothing. The rule tells them apart by comparing the attempt ids read just before the call
 * with the ones returned: clerk-js mutates its resources IN PLACE (fact 14), so only the id strings can say whether
 * THIS press created anything.
 *
 * The case the comparison exists for is the abandoned attempt: a cook who stopped at the finish step earlier, then
 * cancels a new Google sheet, must NOT be shown that old attempt's finish step again.
 */
import { describe, expect, it } from 'vitest';

import { classifySocialOutcome, isProviderCancel } from '../../src/auth/socialSignInOutcome.js';

const before = { signInId: 'sia_old', signUpId: 'sua_old' };

function signUp(
    overrides: Partial<{
        id: string | null;
        status: string | null;
        missingFields: string[];
        unverifiedFields: string[];
        verifications: { externalAccount: { status: string | null } };
    }> = {},
) {
    return {
        id: 'sua_new',
        status: 'missing_requirements',
        missingFields: ['username'],
        unverifiedFields: [],
        ...overrides,
    };
}

function signIn(overrides: Partial<{ id: string | null; status: string | null }> = {}) {
    return { id: 'sia_old', status: null, ...overrides };
}

describe('classifySocialOutcome', () => {
    it('is complete when Clerk made a session (a sign-in, or a sign-up that needed nothing)', () => {
        expect(
            classifySocialOutcome(before, { createdSessionId: 'sess_1', signIn: signIn(), signUp: signUp() }),
        ).toEqual({ kind: 'complete', sessionId: 'sess_1' });
    });

    it('asks for the missing fields when THIS press created a sign-up that stopped at missing_requirements', () => {
        const created = signUp({ missingFields: ['username', 'first_name'] });

        expect(classifySocialOutcome(before, { createdSessionId: null, signIn: signIn(), signUp: created })).toEqual({
            kind: 'needsFields',
            signUp: created,
            fields: [expect.objectContaining({ name: 'first_name' }), expect.objectContaining({ name: 'username' })],
        });
    });

    it('⛔ is CANCELLED, not the finish step, when the returned sign-up is the earlier abandoned one', () => {
        const abandoned = signUp({ id: 'sua_old' });

        expect(classifySocialOutcome(before, { createdSessionId: null, signIn: signIn(), signUp: abandoned })).toEqual({
            kind: 'cancelled',
        });
    });

    it('is cancelled for a first-ever press whose resources are still empty (null ids before and after)', () => {
        expect(
            classifySocialOutcome(
                { signInId: null, signUpId: null },
                { createdSessionId: null, signIn: signIn({ id: null }), signUp: signUp({ id: null, status: null }) },
            ),
        ).toEqual({ kind: 'cancelled' });
    });

    it('is cancelled for the Google hook’s not-loaded answer, which carries no resources at all', () => {
        expect(classifySocialOutcome(before, { createdSessionId: null })).toEqual({ kind: 'cancelled' });
    });

    it('is unsupported when the new sign-up also has an unverified field the finish step cannot verify', () => {
        expect(
            classifySocialOutcome(before, {
                createdSessionId: null,
                signIn: signIn(),
                signUp: signUp({ unverifiedFields: ['email_address'] }),
            }),
        ).toMatchObject({ kind: 'unsupported', status: 'missing_requirements' });
    });

    it('⛔ is unsupported when the new sign-up is missing a field the finish step may not ask for (an email after Apple)', () => {
        expect(
            classifySocialOutcome(before, {
                createdSessionId: null,
                signIn: signIn(),
                signUp: signUp({ missingFields: ['username', 'email_address'] }),
            }),
        ).toMatchObject({ kind: 'unsupported', missingFields: ['username', 'email_address'] });
    });

    it('is unsupported for a new sign-up in any status other than missing_requirements', () => {
        expect(
            classifySocialOutcome(before, {
                createdSessionId: null,
                signIn: signIn(),
                signUp: signUp({ status: 'abandoned' }),
            }),
        ).toMatchObject({ kind: 'unsupported', status: 'abandoned' });
    });

    it('is unsupported for a NEW sign-in that needs a second factor (an account with MFA), never a silent cancel', () => {
        expect(
            classifySocialOutcome(before, {
                createdSessionId: null,
                signIn: signIn({ id: 'sia_new', status: 'needs_second_factor' }),
                signUp: signUp({ id: 'sua_old' }),
            }),
        ).toMatchObject({ kind: 'unsupported', status: 'needs_second_factor' });
    });

    // Apple's hook runs `signUp.create` FIRST and, for an existing account, then `signIn.create({ transfer: true })`, so
    // BOTH ids change and the sign-in is the attempt that stopped. The transferable sign-up must not decide the outcome
    // — above all it must not send an existing account to the username finish step it cannot complete.
    it('⛔ decides from the transfer SIGN-IN when the new sign-up was transferable (Apple ordering, MFA account)', () => {
        expect(
            classifySocialOutcome(before, {
                createdSessionId: null,
                signIn: signIn({ id: 'sia_new', status: 'needs_second_factor' }),
                signUp: signUp({ verifications: { externalAccount: { status: 'transferable' } } }),
            }),
        ).toEqual({ kind: 'unsupported', status: 'needs_second_factor', missingFields: [], unverifiedFields: [] });
    });
});

describe('isProviderCancel', () => {
    it.each<[string, unknown]>([
        ['Google’s cancel code', { code: 'SIGN_IN_CANCELLED', message: 'cancelled' }],
        ['Google iOS’s numeric cancel code', { code: '-5', message: 'The user canceled the sign-in flow.' }],
        ['Apple’s cancel code', { code: 'ERR_REQUEST_CANCELED', message: 'The operation was canceled.' }],
    ])('recognises %s, should a later SDK throw it as its docs say', (_name, error) => {
        expect(isProviderCancel(error)).toBe(true);
    });

    it.each<[string, unknown]>([
        ['a Play services failure', { code: 'GOOGLE_SIGN_IN_ERROR', message: '[10] developer error' }],
        ['an Apple failure', { code: 'ERR_REQUEST_FAILED', message: 'failed' }],
        ['a plain Error', new Error('cancelled')],
        ['undefined', undefined],
    ])('does not mistake %s for a cancel', (_name, error) => {
        expect(isProviderCancel(error)).toBe(false);
    });
});
