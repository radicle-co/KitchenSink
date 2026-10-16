/**
 * Mobile-app-specific user-facing copy (strings that live only in the mobile app). Shared, cross-platform
 * copy lives in the feature packages' `messages.ts`. A {@link LocalizedMessages} dictionary resolved per
 * active locale via `useMessages` from `@commise/i18n/react`. The `en` set is required.
 */
import type { GreetingBucket, HomeNavItemId, RoadmapWidgetId } from '@commise/features-core';
import type { LocalizedMessages } from '@commise/i18n';

/** The shape of the mobile app's own copy. */
export interface MobileMessages {
    readonly home: {
        /**
         * Time-of-day greeting copy, one per bucket. Keyed by the shared {@link GreetingBucket} union so web
         * and mobile greet identically (FR-044); a missing bucket is a compile error, not a blank header.
         */
        readonly greetings: Readonly<Record<GreetingBucket, string>>;
        /** Home's H1 with the cook's name in `{name}`: "Good afternoon, Eliza" (`buildSpec.md` §4.2). */
        readonly greetingsNamed: Readonly<Record<GreetingBucket, string>>;
        /** Accessible label for the Home widget-surface region (the scrollable widget list). */
        readonly regionLabel: string;
        /** Label of the recipe widget's entry point into the full recipes surface. */
        readonly seeAllRecipes: string;
        /**
         * Shown in place of a live Home widget whose body throws (B23) — the mobile counterpart of web's
         * `home.surface.widgetError`, with IDENTICAL copy, so the two platforms degrade the same way (FR-044 /
         * §14). Replaces a `fallback={null}` that left unexplained blank space and told a screen-reader user
         * nothing at all. Roadmap PLACEHOLDER failures stay silent on both platforms — a stand-in's absence is
         * not a loss worth announcing.
         */
        readonly widgetError: string;
        /**
         * Copy for the Home chrome (top bar + bottom tab bar) — US-000 / FR-046. Keyed by the SHARED nav
         * model in `@commise/features-core`, so a destination added there without copy is a compile error.
         */
        readonly chrome: {
            /** The avatar's name, with the cook's name in `{name}` (`buildSpec.md` §3.3). */
            readonly profileButton: string;
            /** The same name when the cook has none yet. */
            readonly profileButtonNoName: string;
            /** Accessible name of the bottom tab-bar navigation landmark. */
            readonly tabNavLabel: string;
            /** Label of each navigation destination, keyed by the shared nav model's id. */
            readonly destinations: Readonly<Record<HomeNavItemId, string>>;
        };
        /**
         * Copy for the roadmap skeleton placeholders (FR-046 / R6 as amended by CR-001). Titles are the REAL
         * widget headings from the mockup — the placeholder shows what is coming, never invented data.
         */
        readonly roadmap: {
            /** The H2 above the placeholder group (`buildSpec.md` §4.2). */
            readonly comingSoonHeading: string;
            /** The one body line under the "Coming soon" heading. */
            readonly comingSoonBody: string;
            /** Visible "Soon" badge on every placeholder. */
            readonly soon: string;
            /** The real heading of each roadmap widget, keyed by the shared roadmap registry's id. */
            readonly titles: Readonly<Record<RoadmapWidgetId, string>>;
        };
        /** Copy for the once-per-session subscription upgrade nudge (shown when a free-tier viewer taps a
         * premium-gated widget entry point). No live v1 widget is gated, so it ships ready for 005–009. */
        readonly nudge: {
            /** The nudge dialog's heading (also its accessible label). */
            readonly title: string;
            /** The nudge's supporting body copy. */
            readonly body: string;
            /** The primary upgrade action (dismisses in v1; the subscription surface is owned by 010). */
            readonly upgrade: string;
            /** The dismiss action. */
            readonly dismiss: string;
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
    /** The native-only photo control's copy. The rest of the Profile page's copy is `profileMessages`. */
    readonly profile: {
        /** Section label above the avatar picker. */
        readonly avatarLabel: string;
        /** Accessible name of the avatar image preview. */
        readonly avatarImageLabel: string;
    };
    readonly recipes: {
        /** Accessible label shown while a single recipe's detail is loading. */
        readonly detailLoading: string;
        /** Message shown when a recipe's detail fails to load. */
        readonly detailError: string;
        /** Message shown when the recipe does not exist or is not the viewer's to see — no retry is offered. */
        readonly detailNotFound: string;
        /** Label of the retry affordance when a recipe's detail fails to load. */
        readonly detailRetry: string;
        /** Label of the back affordance on the recipe-detail screen. */
        readonly back: string;
        /** Alert shown when creating a recipe fails. */
        readonly createError: string;
        /**
         * Shown after a successful create while chosen photos are still uploading (U33). A save is create-THEN-
         * upload, and the cook must not be told it is one call.
         */
        readonly photosFlushingNotice: string;
        /** The explicit "leave without the photos that would not upload" action (U33). */
        readonly photosFinishWithout: string;
        /** Alert shown when saving recipe edits fails. */
        readonly saveError: string;
        /** Title of the first-step guidance banner shown on a brand-new (empty) create form (U6). */
        readonly createGuidanceTitle: string;
        /** Body of the first-step guidance banner shown on a brand-new (empty) create form (U6). */
        readonly createGuidanceBody: string;
        /** Alert shown when deleting a recipe fails. */
        readonly deleteError: string;
        /** Alert shown when cloning a recipe fails. */
        readonly cloneError: string;
        /** Accessible label shown while the version history is loading. */
        readonly versionsLoading: string;
        /** Message shown when the version history fails to load. */
        readonly versionsError: string;
        /** Label of the retry action in the version-history error state (B21 — web parity: an error state
         *  must offer a way forward, not only a way back). */
        readonly versionsRetry: string;
    };
    readonly collections: {
        /** Accessible label shown while a single collection is loading. */
        readonly detailLoading: string;
        /** Message shown when a collection fails to load. */
        readonly detailError: string;
        /** Message shown when the collection does not exist or is not the viewer's to see — no retry is offered. */
        readonly detailNotFound: string;
        /** Label of the retry affordance when a collection fails to load. */
        readonly detailRetry: string;
        /** Label of the back affordance on the collection-detail screen. */
        readonly back: string;
        /** Alert shown when saving a collection (create or rename) fails. */
        readonly saveError: string;
    };
    readonly recipesNav: {
        /** Tab label for the caller's own recipes (the list). */
        readonly myRecipes: string;
        /** Tab label for public-recipe discovery. */
        readonly discover: string;
        /** Tab label for the caller's collections. */
        readonly collections: string;
    };
    readonly common: {
        readonly somethingWentWrong: string;
        /** Body copy for the root-level crash fallback (B18) — the app-wide safety net around `AppRoot`. */
        readonly rootErrorBody: string;
        /** Body copy for the same fallback when Home is what crashed, where Back to Home is not offered. */
        readonly rootErrorBodyHome: string;
        /** Label of the retry affordance on the root-level crash fallback. */
        readonly retry: string;
        /** Label of the root fallback's way out of a crashed screen, back to Home. */
        readonly backToHome: string;
        /**
         * The confirmation raised when a form with unsaved work is left — by its own back/cancel control or
         * by Android's system back button, which are two entry points to ONE guard.
         *
         * ⛔ It is app-level copy rather than per-screen copy because the QUESTION is the same wherever it
         * is asked; a per-screen copy of it is how one surface comes to ask something subtly different from
         * its neighbour. It is deliberately NOT read from `@commise/features-recipes`'s `wizardMessages`:
         * that dictionary is the recipe wizard's own, and a collections screen that consumed it would take
         * a dependency on the wizard's whole catalogue to borrow four strings.
         */
        readonly discard: {
            /** The dialog's heading, and its accessible name. */
            readonly title: string;
            /** Body copy, stating what confirming costs. */
            readonly body: string;
            /** The destructive confirm action. */
            readonly confirm: string;
            /** The cancel action — stay on the form, keep the work. */
            readonly cancel: string;
        };
    };
}

export const mobileMessages: LocalizedMessages<MobileMessages> = {
    en: {
        home: {
            greetings: {
                morning: 'Good morning',
                afternoon: 'Good afternoon',
                evening: 'Good evening',
                night: 'Still up?',
            },
            greetingsNamed: {
                morning: 'Good morning, {name}',
                afternoon: 'Good afternoon, {name}',
                evening: 'Good evening, {name}',
                night: 'Still up, {name}?',
            },
            regionLabel: 'Home',
            seeAllRecipes: 'See all recipes',
            widgetError: 'This section couldn’t load.',
            chrome: {
                profileButton: 'Profile, {name}',
                profileButtonNoName: 'Profile',
                tabNavLabel: 'Main',
                destinations: {
                    home: 'Home',
                    recipes: 'Recipes',
                    discover: 'Discover',
                    'meal-plan': 'Plan',
                    grocery: 'Shop',
                },
            },
            roadmap: {
                comingSoonHeading: 'Coming soon',
                comingSoonBody: 'Meal plans, a grocery list and daily nutrition are on the way.',
                soon: 'Soon',
                titles: {
                    nutrition: 'Today’s nutrition',
                    'resume-cooking': 'Resume cooking',
                    'meal-plan': 'This week’s meals',
                },
            },
            nudge: {
                title: 'Unlock Commise Pro',
                body: 'Upgrade to Commise Pro to use this feature.',
                upgrade: 'See plans',
                dismiss: 'Maybe later',
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
        profile: {
            avatarLabel: 'Profile photo',
            avatarImageLabel: 'Your profile photo',
        },
        recipes: {
            detailLoading: 'Loading recipe…',
            detailError: 'We couldn’t load this recipe.',
            detailNotFound: 'This recipe isn’t available.',
            detailRetry: 'Try again',
            back: 'Back',
            createError: 'We couldn’t create your recipe. Please try again.',
            photosFlushingNotice: 'Recipe saved. Finishing your photo uploads…',
            photosFinishWithout: 'Finish without the remaining photos',
            saveError: 'We couldn’t save your changes. Please try again.',
            createGuidanceTitle: 'Let’s build your recipe',
            createGuidanceBody:
                'Start with a title and the basics. You’ll add ingredients, steps, and photos as you go — tap Next when a step is ready.',
            deleteError: 'We couldn’t delete this recipe. Please try again.',
            cloneError: 'We couldn’t clone this recipe. Please try again.',
            versionsLoading: 'Loading version history…',
            versionsError: 'We couldn’t load the version history.',
            versionsRetry: 'Try again',
        },
        collections: {
            detailLoading: 'Loading collection…',
            detailError: 'We couldn’t load this collection.',
            detailNotFound: 'We couldn’t find that collection.',
            detailRetry: 'Try again',
            back: 'Back',
            saveError: 'We couldn’t save this collection. Please try again.',
        },
        recipesNav: {
            myRecipes: 'My recipes',
            discover: 'Discover',
            collections: 'Collections',
        },
        common: {
            somethingWentWrong: 'Something went wrong',
            rootErrorBody: 'We hit a snag loading this screen. Try again, or go back to Home.',
            rootErrorBodyHome: 'We hit a snag loading Home. Please try again.',
            retry: 'Try again',
            backToHome: 'Back to Home',
            discard: {
                title: 'Discard unsaved changes?',
                body: 'You have unsaved changes. Leaving now will discard them.',
                confirm: 'Discard changes',
                cancel: 'Keep editing',
            },
        },
    },
};
