/**
 * @module @commise/features-account/authSurfaceMessages — the words both sign-in surfaces say, authored once.
 *
 * The two platforms draw sign-in differently, and that stays: web hands Clerk's hosted form its words through
 * `<ClerkProvider localization>`, while mobile draws its own forms. But the brand line, the sign-up prompt and link, and
 * the two email messages are the same sentences, and each app used to author them. They are authored here; web maps them
 * onto Clerk's localization keys and mobile re-exposes them in its `auth` block. The Clerk error-code tables stay in each
 * app, because the two SDKs expose different shapes.
 *
 * The names follow mobile's, which the screens already read: `noAccountPrompt` and `signUpLink` are Clerk's `actionText`
 * and `actionLink` on web.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** The sentences both sign-in surfaces share. */
export interface AuthSurfaceMessages {
    /** The one line under the sign-in and sign-up titles (`buildSpec.md` §8). */
    readonly brandLine: string;
    /** The sign-in footer's question, beside the link to sign-up. */
    readonly noAccountPrompt: string;
    /** The sign-in footer's link: the ONLY way to register (FR-045a). */
    readonly signUpLink: string;
    /** Said when the email field is empty (also the wording for Clerk's "missing identifier"). */
    readonly emailRequired: string;
    /** Said when the email is not a valid address (also the wording for Clerk's "identifier is invalid"). */
    readonly emailInvalid: string;
}

/** The shared sign-in copy. The `en` set is required; adding a locale is another key. */
export const authSurfaceMessages: LocalizedMessages<AuthSurfaceMessages> = {
    en: {
        brandLine: 'Your recipes, in one place.',
        noAccountPrompt: 'New to Commise?',
        signUpLink: 'Create an account',
        emailRequired: 'Enter your email address.',
        emailInvalid: 'Enter a valid email address.',
    },
};
