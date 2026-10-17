/**
 * Mobile-app-specific user-facing copy (strings that live only in the mobile app: the sign-in forms and the root crash
 * body). Copy web and mobile say identically lives in the feature packages' `messages.ts`
 * (`@commise/features-core/home`'s `homeMessages`, the recipe, collection and version sets), and
 * `packages/tools/repoGuards/__tests__/appCopyIsNotDuplicated.test.ts` fails when a sentence is authored in both apps' own
 * dictionaries. A {@link LocalizedMessages} dictionary resolved per
 * active locale via `useMessages` from `@commise/i18n/react`. The `en` set is required.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** The shape of the mobile app's own copy. */
export interface MobileMessages {
    readonly home: {
        /** The paid-features nudge's mobile-only copy; its title, body and actions are `homeMessages.nudge`. */
        readonly nudge: {
            /** The accessible name of the nudge sheet's icon-only × close control. House form: "Close {thing}". */
            readonly close: string;
        };
    };
    /** Copy for the sign-in / sign-up surface (U2). All auth copy is localized (repo mandate). */
    /**
     * The sign-in and sign-up screens' copy. The sentences both platforms say (brand line, sign-up prompt and link, the
     * two email messages) are `authSurfaceMessages` in `@commise/features-account`; call sites read them per locale with
     * `useMessages(authSurfaceMessages)` and they are deliberately NOT part of this dictionary.
     */
    readonly auth: {
        /** Brand wordmark shown atop the sign-in / sign-up screens. */
        readonly brand: string;
        /** The sign-in screen's H1 (`buildSpec.md` §8: "Sign in to Commise"). */
        readonly signInTitle: string;
        /** The sign-up screen's H1. */
        readonly createHeading: string;
        /** Alert above the primary action when Clerk could not be reached (`buildSpec.md` §8 "States"). */
        readonly networkError: string;
        /** Visible label for the email field (also its accessible name). */
        readonly emailLabel: string;
        /** Placeholder shown in the empty email field. */
        readonly emailPlaceholder: string;
        /** Visible label for the password field. */
        readonly passwordLabel: string;
        /** Placeholder shown in the empty password field. */
        readonly passwordPlaceholder: string;
        /** Visible label for the email verification-code field. */
        readonly codeLabel: string;
        /** Placeholder shown in the empty verification-code field. */
        readonly codePlaceholder: string;
        /** Prompt shown above the verification-code field. */
        readonly codePrompt: string;
        /** Primary sign-in submit label. */
        readonly signInAction: string;
        /** Primary verification submit label. */
        readonly verifyAction: string;
        /** Code-step control that sends a fresh verification code. */
        readonly resendCodeAction: string;
        /** Code-step control that abandons the sign-in attempt and returns to the credentials. */
        readonly startOverAction: string;
        /** Primary create-account submit label. */
        readonly createAccountAction: string;
        /** Prompt beside the link that toggles from sign-up to sign-in. */
        readonly haveAccountPrompt: string;
        /** Label of the link that toggles from sign-up to sign-in. */
        readonly signInLink: string;
        /** Localized fallback when a sign-in fails without a Clerk-supplied message. */
        readonly signInFailed: string;
        /** Localized fallback when a sign-up fails without a Clerk-supplied message. */
        readonly signUpFailed: string;
        /** Localized fallback when a code verification fails without a Clerk-supplied message. */
        readonly verifyFailed: string;
        /** Localized fallback when sending a verification code fails without a Clerk-supplied message. */
        readonly sendCodeFailed: string;
        /** Shown when the sign-in needs a factor this custom form does not implement. */
        readonly additionalVerification: string;
        /** Contextual caption + accessible name of the spinner shown while the session is being resolved. */
        readonly sessionLoading: string;
        /**
         * The Google button's label on BOTH auth screens (plan 012 D9): the same tap may sign in or create an account.
         * The Apple button's label is the system's own (`AppleAuthenticationButton`), so it has no key.
         */
        readonly continueWithGoogle: string;
        /** The word between the provider buttons and the email form. */
        readonly orDivider: string;
        /** Polite status under the provider buttons while a provider sheet or the Clerk exchange is in flight. */
        readonly socialBusy: string;
        /** Google's SDK cannot run on this device (Play services missing or outdated). */
        readonly googleUnavailable: string;
        /** Sign in with Apple is not set up on this device. */
        readonly appleUnavailable: string;
        /** Any other provider failure. `{provider}` is the brand name, never translated. */
        readonly socialFailed: string;
        /** H1 of the step that asks for what Google / Apple did not supply. */
        readonly finishTitle: string;
        /** The line under that H1. */
        readonly finishPrompt: string;
        /** Says which address the account is for — Apple's relay address included. Contains `{email}`. */
        readonly finishSigningUpAs: string;
        /** Visible label for the first-name field. */
        readonly firstNameLabel: string;
        /** Visible label for the last-name field. */
        readonly lastNameLabel: string;
        /** Visible label for the username field. */
        readonly usernameLabel: string;
        /**
         * What the username is FOR (plan 012 D11). Its length rule is not restated: Clerk's bound is customisable per
         * instance, so Clerk's own error states it.
         */
        readonly usernameHint: string;
        /** Said when the first name is left empty. */
        readonly firstNameRequired: string;
        /** Said when the last name is left empty. */
        readonly lastNameRequired: string;
        /** Said when the username is left empty. */
        readonly usernameRequired: string;
        /** Said when the sign-up password is left empty. */
        readonly passwordRequired: string;
        /** Shown when a sign-up needs something neither the sign-up form nor its finish step can ask for. */
        readonly signUpUnsupported: string;
    };
}

export const mobileMessages: LocalizedMessages<MobileMessages> = {
    en: {
        home: {
            nudge: {
                close: 'Close upgrade offer',
            },
        },
        auth: {
            brand: 'Commise',
            signInTitle: 'Sign in to Commise',
            createHeading: 'Create your account',
            networkError: 'We couldn’t reach the sign-in service. Check your connection and try again.',
            emailLabel: 'Email',
            emailPlaceholder: 'you@example.com',
            passwordLabel: 'Password',
            passwordPlaceholder: 'Your password',
            codeLabel: 'Verification code',
            codePlaceholder: '123456',
            codePrompt: 'Enter the verification code sent to your email.',
            signInAction: 'Sign in',
            verifyAction: 'Verify',
            resendCodeAction: 'Send a new code',
            startOverAction: 'Start over',
            createAccountAction: 'Create account',
            haveAccountPrompt: 'Already have an account?',
            signInLink: 'Sign in',
            signInFailed: 'We couldn’t sign you in. Please try again.',
            signUpFailed: 'We couldn’t create your account. Please try again.',
            verifyFailed: 'We couldn’t verify that code. Please try again.',
            sendCodeFailed: 'We couldn’t send a verification code. Please try again.',
            additionalVerification: 'Additional verification is required to finish signing in.',
            sessionLoading: 'Checking your session…',
            continueWithGoogle: 'Continue with Google',
            orDivider: 'or',
            socialBusy: 'Signing you in…',
            googleUnavailable:
                'Google sign-in needs an up-to-date Google Play services on this device. Update it, or use your email.',
            appleUnavailable:
                'Sign in with Apple isn’t set up on this device. Sign in to your Apple Account in Settings, or use your email.',
            socialFailed: 'We couldn’t sign you in with {provider}. Try again, or use your email.',
            finishTitle: 'Finish creating your account',
            finishPrompt: 'We need these to set up your account.',
            finishSigningUpAs: 'Signing up as {email}',
            firstNameLabel: 'First name',
            lastNameLabel: 'Last name',
            usernameLabel: 'Username',
            usernameHint: 'Your public name on recipes you publish.',
            firstNameRequired: 'Enter your first name.',
            lastNameRequired: 'Enter your last name.',
            usernameRequired: 'Choose a username.',
            passwordRequired: 'Enter a password.',
            signUpUnsupported: 'We can’t finish creating your account in the app. Try again on the Commise website.',
        },
    },
};
