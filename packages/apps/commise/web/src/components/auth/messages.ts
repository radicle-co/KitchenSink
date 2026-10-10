/**
 * @module components/auth/messages — user-facing copy for the web account-state surfaces that the Profile page hosts.
 *
 * The Profile page's own copy is shared with mobile and lives in `@commise/features-account/profile`
 * (`profileMessages`); the danger-zone copy (close/erase) lives in `@commise/features-account/danger`. What is left
 * here is only what has no cross-platform twin: the state gate's loading line and the notice shown when an erasure was
 * accepted but the follow-up sign-out failed. Both the server route and the client controls resolve this dictionary,
 * so no user string is a hard-coded literal (repo localization mandate).
 *
 * The `en` set is required and is the guaranteed fallback; adding a locale is another key.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy shared by the session controls. */
export interface SessionMessages {
    /**
     * Alert shown when an account ERASURE was accepted (202) but the follow-up sign-out / navigation failed.
     * Deliberately distinct from the sign-out row's own failure and from the erasure dialog's submit error: the
     * erasure DID succeed, so telling the viewer to retry it would be a lie — the outstanding action is only to
     * leave the (now-destroyed) account's session.
     */
    readonly eraseSignOutFailed: string;
}

/** Copy for the `AccountStateGate` load gap. */
export interface AccountStateMessages {
    /** Accessible status shown while the client resolves the account state. */
    readonly loading: string;
}

/** Copy for the sign-in and sign-up forms (`buildSpec.md` §8). */
export interface AuthSurfaceMessages {
    /** The brand line under the sign-in title. It becomes "Cook with confidence. Plan with ease." when Plan ships. */
    readonly brandLine: string;
    /** The sign-in footer's question; Clerk's `actionText`. */
    readonly signUpPrompt: string;
    /** The sign-in footer's link, the only way to register; Clerk's `actionLink`. */
    readonly signUpAction: string;
}

/** The shape of the web auth surface's copy. */
export interface AuthMessages {
    /** The sign-in and sign-up forms' copy. */
    readonly surface: AuthSurfaceMessages;
    /** Session copy. */
    readonly session: SessionMessages;
    /** Account-state gate copy. */
    readonly state: AccountStateMessages;
}

/** The web auth surface's localized copy. The `en` set is required. */
export const authMessages: LocalizedMessages<AuthMessages> = {
    en: {
        surface: {
            brandLine: 'Your recipes, in one place.',
            signUpPrompt: 'New to Commise?',
            signUpAction: 'Create an account',
        },
        session: {
            eraseSignOutFailed:
                'Your data is being erased, but we couldn’t sign you out. Sign out to finish leaving this account.',
        },
        state: {
            loading: 'Loading your account…',
        },
    },
};
