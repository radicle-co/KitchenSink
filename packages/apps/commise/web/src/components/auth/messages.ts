/**
 * @module components/auth/messages — user-facing copy for the web account-state surfaces that the Profile page hosts.
 *
 * The Profile page's own copy is shared with mobile and lives in `@commise/features-account/profile`
 * (`profileMessages`); the danger-zone copy (close/erase) lives in `@commise/features-account/danger`. What is left
 * here is only what has no cross-platform twin: the state gate's loading line and the sign-in surface's copy. The
 * notice shown when an erasure was accepted but the follow-up sign-out failed lives with the rest of the erase copy in
 * `accountDangerMessages`. Both the server route and the client controls resolve this dictionary,
 * so no user string is a hard-coded literal (repo localization mandate).
 *
 * The `en` set is required and is the guaranteed fallback; adding a locale is another key.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for the `AccountStateGate` load gap. */
export interface AccountStateMessages {
    /** Accessible status shown while the client resolves the account state. */
    readonly loading: string;
}

/**
 * Copy for the sign-in and sign-up forms that only web has. The sentences both platforms say (the brand line, the sign-up
 * prompt and link, the two email messages) are `authSurfaceMessages` in `@commise/features-account`.
 */
interface WebSignInErrorMessages {
    /** Shown when no account has the email address that was typed. */
    readonly accountNotFound: string;
}

/** The shape of the web auth surface's copy. */
export interface AuthMessages {
    /** The sign-in and sign-up forms' copy. */
    readonly surface: WebSignInErrorMessages;
    /** Account-state gate copy. */
    readonly state: AccountStateMessages;
}

/** The web auth surface's localized copy. The `en` set is required. */
export const authMessages: LocalizedMessages<AuthMessages> = {
    en: {
        surface: {
            accountNotFound: 'We couldn’t find an account with that email address.',
        },
        state: {
            loading: 'Loading your account…',
        },
    },
};
