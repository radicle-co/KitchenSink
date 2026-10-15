/**
 * The sign-up field registry (plan 012 D8 — the shape plan 010 D13 named): which profile fields a sign-up can ask for,
 * how each is asked, and which of Clerk's `missingFields` a given step may ask for at all. The finish step after a
 * social sign-up asks ONLY for what the provider did not supply, and never for an email or a password (D11) — so an
 * unknown or un-askable field must surface as `unknown`, never be silently dropped (a dropped field strands the cook on a
 * step that cannot finish).
 */
import { ClerkAPIResponseError } from '@clerk/shared/error';
import { describe, expect, it } from 'vitest';

import {
    fieldOfClerkError,
    SIGN_UP_FIELDS,
    signUpFieldPlan,
    SOCIAL_FINISH_FIELDS,
} from '../../src/auth/signUpFields.js';

/** A Clerk API error naming one form parameter, as the FAPI returns it. */
function clerkError(paramName: string | undefined, code = 'form_param_format_invalid', longMessage = 'Clerk says no') {
    return new ClerkAPIResponseError('x', {
        data: [{ code, message: longMessage, long_message: longMessage, meta: { param_name: paramName } }],
        status: 422,
    });
}

describe('SIGN_UP_FIELDS', () => {
    it('lists the four profile fields in the order a form asks for them', () => {
        expect(SIGN_UP_FIELDS.map((field) => field.name)).toEqual([
            'first_name',
            'last_name',
            'username',
            'email_address',
        ]);
    });

    it('names, for each field, the signUp.update parameter Clerk takes it as', () => {
        expect(Object.fromEntries(SIGN_UP_FIELDS.map((field) => [field.name, field.param]))).toEqual({
            first_name: 'firstName',
            last_name: 'lastName',
            username: 'username',
            email_address: 'emailAddress',
        });
    });

    it('offers the OS autofill each field needs (SC 1.3.5), and never autocapitalises a username or an address', () => {
        const byName = Object.fromEntries(SIGN_UP_FIELDS.map((field) => [field.name, field]));

        expect(byName['first_name']).toMatchObject({ autoComplete: 'given-name', autoCapitalize: 'words' });
        expect(byName['last_name']).toMatchObject({ autoComplete: 'family-name', autoCapitalize: 'words' });
        expect(byName['username']).toMatchObject({ autoComplete: 'username', autoCapitalize: 'none' });
        expect(byName['email_address']).toMatchObject({ autoComplete: 'email', autoCapitalize: 'none' });
    });
});

describe('signUpFieldPlan', () => {
    it('asks for exactly the missing fields the step can ask for, in registry order', () => {
        const plan = signUpFieldPlan(['username', 'first_name'], SOCIAL_FINISH_FIELDS);

        expect(plan.fields.map((field) => field.name)).toEqual(['first_name', 'username']);
        expect(plan.unknown).toEqual([]);
    });

    it('asks for nothing when nothing is missing', () => {
        expect(signUpFieldPlan([], SOCIAL_FINISH_FIELDS)).toEqual({ fields: [], unknown: [] });
    });

    it('⛔ reports an email the finish step may not ask for (Apple may have given a relay address, D11)', () => {
        expect(signUpFieldPlan(['username', 'email_address'], SOCIAL_FINISH_FIELDS)).toEqual({
            fields: [expect.objectContaining({ name: 'username' })],
            unknown: ['email_address'],
        });
    });

    it.each(['password', 'phone_number', 'legal_accepted', 'saml'])(
        '⛔ reports %s, a field no step here can ask for, instead of dropping it',
        (missing) => {
            expect(signUpFieldPlan([missing, 'username'], SOCIAL_FINISH_FIELDS).unknown).toEqual([missing]);
        },
    );
});

describe('fieldOfClerkError', () => {
    it.each([
        ['first_name', 'first_name'],
        ['last_name', 'last_name'],
        ['username', 'username'],
        ['email_address', 'email_address'],
    ] as const)('routes a Clerk error on %s to that field, with Clerk’s own words', (paramName, field) => {
        expect(fieldOfClerkError(clerkError(paramName, 'form_identifier_exists', 'That username is taken.'))).toEqual({
            field,
            message: 'That username is taken.',
        });
    });

    it.each<[string, unknown]>([
        ['an error on the password', clerkError('password')],
        ['an error naming no parameter', clerkError(undefined)],
        ['a plain Error', new Error('boom')],
        ['a string', 'boom'],
        ['undefined', undefined],
    ])('routes %s to no field (it belongs in the alert)', (_name, error) => {
        expect(fieldOfClerkError(error)).toBeUndefined();
    });
});
