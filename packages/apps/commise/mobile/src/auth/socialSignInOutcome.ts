/**
 * @module auth/socialSignInOutcome — what a finished native Google / Apple flow MEANS (plan 012 D5).
 *
 * `@clerk/expo@4.6.0`'s `useSignInWithGoogle` / `useSignInWithApple` answer `{ createdSessionId: null, signIn, signUp }`
 * for four different things: the person cancelled the provider's sheet (both hooks SWALLOW the cancel — the docs say
 * they throw), Clerk was not loaded, the sign-up stopped at `missing_requirements` (the required username), or a status
 * the app cannot finish (a second factor). The session id alone therefore decides nothing.
 *
 * The rule compares the attempt ids read just before the call with the ones returned. clerk-js mutates its resources
 * IN PLACE (`_baseMutate` returns `this.fromJSON(…)`), so object identity says nothing; and `signIn.create` /
 * `signUp.create` always mint a new id. A changed id is "this press created an attempt"; unchanged ids are a cancel —
 * which is what stops a cancel from reopening an earlier, abandoned sign-up's finish step.
 *
 * @pattern Visitor — an exhaustive union the caller switches over.
 *
 * Pure.
 */
import { SOCIAL_FINISH_FIELDS, signUpFieldPlan, type SignUpFieldSpec } from './signUpFields.js';

/** The attempt ids on the Clerk client just before the flow began (`client.signIn.id` / `client.signUp.id`). */
export interface AttemptIds {
    readonly signInId: string | null;
    readonly signUpId: string | null;
}

/** The members of a Clerk sign-up resource this rule reads. */
export interface SignUpAttempt {
    readonly id?: string | null;
    readonly status: string | null;
    readonly missingFields: readonly string[];
    readonly unverifiedFields: readonly string[];
    /** `transferable` when the provider account already belongs to a user, so a transfer sign-in follows. */
    readonly verifications?: { readonly externalAccount?: { readonly status?: string | null } | null } | null;
}

/** The members of a Clerk sign-in resource this rule reads. */
export interface SignInAttempt {
    readonly id?: string | null;
    readonly status: string | null;
}

/** What the hooks return (`StartGoogleAuthenticationFlowReturnType` / `…AppleAuthenticationFlowReturnType`). */
export interface SocialFlowResult<TSignUp extends SignUpAttempt> {
    readonly createdSessionId: string | null;
    readonly signIn?: SignInAttempt;
    readonly signUp?: TSignUp;
}

/** What the press amounted to. */
export type SocialOutcome<TSignUp extends SignUpAttempt> =
    | { readonly kind: 'complete'; readonly sessionId: string }
    | { readonly kind: 'cancelled' }
    /** The sign-up this press created needs fields the finish step can ask for. `signUp` is the RETURNED resource. */
    | { readonly kind: 'needsFields'; readonly signUp: TSignUp; readonly fields: readonly SignUpFieldSpec[] }
    /** A status, or a field, this app cannot finish. Reported, and the person told. */
    | {
          readonly kind: 'unsupported';
          readonly status: string | null;
          readonly missingFields: readonly string[];
          readonly unverifiedFields: readonly string[];
      };

const changed = (id: string | null | undefined, before: string | null) =>
    id !== undefined && id !== null && id !== before;

/**
 * @param before - The attempt ids read just before the flow began.
 * @param result - What the hook returned.
 * @returns The outcome. Pure.
 */
export function classifySocialOutcome<TSignUp extends SignUpAttempt>(
    before: AttemptIds,
    result: SocialFlowResult<TSignUp>,
): SocialOutcome<TSignUp> {
    if (result.createdSessionId !== null) {
        return { kind: 'complete', sessionId: result.createdSessionId };
    }

    const { signIn, signUp } = result;
    const signInCreated = signIn !== undefined && changed(signIn.id, before.signInId);

    // Apple's hook creates the sign-up FIRST and, when its provider account is `transferable` (the account exists),
    // follows with `signIn.create({ transfer: true })`: the sign-in is then the attempt that stopped, not the sign-up.
    // (Google's runs the other way round, so its sign-up is the later attempt and is never transferable here.)
    const transferredToSignIn = signInCreated && signUp?.verifications?.externalAccount?.status === 'transferable';

    if (signUp !== undefined && changed(signUp.id, before.signUpId) && !transferredToSignIn) {
        const unsupported = {
            kind: 'unsupported',
            status: signUp.status,
            missingFields: signUp.missingFields,
            unverifiedFields: signUp.unverifiedFields,
        } as const;

        if (signUp.status !== 'missing_requirements' || signUp.unverifiedFields.length > 0) {
            return unsupported;
        }

        const plan = signUpFieldPlan(signUp.missingFields, SOCIAL_FINISH_FIELDS);

        if (plan.unknown.length > 0 || plan.fields.length === 0) {
            return unsupported;
        }

        return { kind: 'needsFields', signUp, fields: plan.fields };
    }

    if (signInCreated) {
        return { kind: 'unsupported', status: signIn.status, missingFields: [], unverifiedFields: [] };
    }

    return { kind: 'cancelled' };
}

/** The codes the provider SDKs use for "the person closed the sheet": Google (Android, iOS) and Apple. */
const CANCEL_CODES: ReadonlySet<string> = new Set(['SIGN_IN_CANCELLED', '-5', 'ERR_REQUEST_CANCELED']);

/**
 * A THROWN cancel, should a later SDK throw as its docs say rather than return quietly as 4.6.0 does.
 *
 * @returns True when `error` is a provider cancel. Pure.
 */
export function isProviderCancel(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return false;
    }

    const { code } = error as { readonly code: unknown };

    return (typeof code === 'string' || typeof code === 'number') && CANCEL_CODES.has(String(code));
}
