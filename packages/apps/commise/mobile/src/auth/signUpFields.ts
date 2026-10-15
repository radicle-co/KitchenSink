/**
 * @module auth/signUpFields — the profile fields a native sign-up can ask for (plan 012 D8, the shape plan 010 D13
 * named): first name, last name, username and email, which both Clerk instances require (owner ruling 2026-10-13).
 *
 * One registry serves both askers. The typed sign-up form asks for all of them; the finish step after a Google / Apple
 * sign-up asks only for those Clerk still lists in `missingFields` and that the step is ALLOWED to ask
 * ({@link SOCIAL_FINISH_FIELDS} — never an email, which Apple may have replaced with a relay address, and never a
 * password, D11). A missing field the step cannot ask for is returned as `unknown`, never dropped: a dropped field is
 * a step that can never finish.
 *
 * @pattern Registry — {@link SIGN_UP_FIELDS}, keyed by Clerk's field name.
 *
 * Pure.
 */
import type { InputAutoComplete } from '@commise/ui/input';
import { isClerkAPIResponseError } from '@clerk/shared/error';

/** A profile field, by the name Clerk lists it under in `missingFields` and `meta.paramName`. */
export type SignUpFieldName = 'first_name' | 'last_name' | 'username' | 'email_address';

/** How one field is asked for. */
export interface SignUpFieldSpec {
    readonly name: SignUpFieldName;
    /** The `signUp.create` / `signUp.update` parameter Clerk takes it as. */
    readonly param: 'firstName' | 'lastName' | 'username' | 'emailAddress';
    /** The OS autofill it offers (WCAG 2.2 SC 1.3.5). */
    readonly autoComplete: InputAutoComplete;
    /** Names are capitalised as words; a username or an address is typed exactly. */
    readonly autoCapitalize: 'none' | 'words';
    /** A username or an address is not a word, so the keyboard must not "correct" it. */
    readonly autoCorrect: boolean;
    /** The keyboard to show. */
    readonly inputMode: 'text' | 'email';
}

/** Every field, in the order a form asks for them. */
export const SIGN_UP_FIELDS: readonly SignUpFieldSpec[] = [
    {
        name: 'first_name',
        param: 'firstName',
        autoComplete: 'given-name',
        autoCapitalize: 'words',
        autoCorrect: false,
        inputMode: 'text',
    },
    {
        name: 'last_name',
        param: 'lastName',
        autoComplete: 'family-name',
        autoCapitalize: 'words',
        autoCorrect: false,
        inputMode: 'text',
    },
    {
        name: 'username',
        param: 'username',
        autoComplete: 'username',
        autoCapitalize: 'none',
        autoCorrect: false,
        inputMode: 'text',
    },
    {
        name: 'email_address',
        param: 'emailAddress',
        autoComplete: 'email',
        autoCapitalize: 'none',
        autoCorrect: false,
        inputMode: 'email',
    },
];

/** What the finish step after a social sign-up may ask for (D11: no email, no password). */
export const SOCIAL_FINISH_FIELDS: ReadonlySet<SignUpFieldName> = new Set(['first_name', 'last_name', 'username']);

/** The fields a step asks for, and the missing ones it cannot. */
export interface SignUpFieldPlan {
    readonly fields: readonly SignUpFieldSpec[];
    readonly unknown: readonly string[];
}

/**
 * @param missing - Clerk's `signUp.missingFields`.
 * @param askable - The fields this step may ask for.
 * @returns The fields to ask for, in registry order, and every missing field outside `askable`. Pure.
 */
export function signUpFieldPlan(missing: readonly string[], askable: ReadonlySet<SignUpFieldName>): SignUpFieldPlan {
    const askableNames: ReadonlySet<string> = askable;

    return {
        fields: SIGN_UP_FIELDS.filter((field) => askable.has(field.name) && missing.includes(field.name)),
        unknown: missing.filter((name) => !askableNames.has(name)),
    };
}

/** A Clerk error that belongs to one field. */
export interface FieldError {
    readonly field: SignUpFieldName;
    /** Clerk's own words for it ("That username is taken."). */
    readonly message: string;
}

const FIELD_NAMES: ReadonlySet<string> = new Set(SIGN_UP_FIELDS.map((field) => field.name));

function isFieldName(name: string): name is SignUpFieldName {
    return FIELD_NAMES.has(name);
}

/**
 * Route a Clerk API error to the field it names (`meta.paramName`), so the message sits under that field (SC 3.3.1).
 *
 * @param error - What a `signUp.create` / `signUp.update` threw or returned.
 * @returns The field and Clerk's message, or `undefined` when the error names no registry field. Pure.
 */
export function fieldOfClerkError(error: unknown): FieldError | undefined {
    // Clerk's guard THROWS for a non-object (a string or `undefined` is a legitimate failure here), so object first.
    if (typeof error !== 'object' || error === null || !isClerkAPIResponseError(error)) {
        return undefined;
    }

    const [first] = error.errors;
    const paramName = first?.meta?.paramName;

    if (first === undefined || paramName === undefined || !isFieldName(paramName)) {
        return undefined;
    }

    return { field: paramName, message: first.longMessage ?? first.message };
}
