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
            /** Title shown in the top bar on the Home route. */
            readonly pageTitle: string;
            /** Accessible name of the search entry point. */
            readonly search: string;
            /** Accessible name of the notifications control. */
            readonly notifications: string;
            /** Accessible name of the avatar / account entry point. */
            readonly account: string;
            /** Fallback avatar accessible name when the viewer has no display name yet. */
            readonly accountNoName: string;
            /** Accessible name of the bottom tab-bar navigation landmark. */
            readonly tabNavLabel: string;
            /** Suffix appended to an unreachable destination's accessible name (never a dead tab). */
            readonly comingSoonSuffix: string;
            /** Label of each navigation destination, keyed by the shared nav model's id. */
            readonly destinations: Readonly<Record<HomeNavItemId, string>>;
        };
        /**
         * Copy for the roadmap skeleton placeholders (FR-046 / R6 as amended by CR-001). Titles are the REAL
         * widget headings from the mockup — the placeholder shows what is coming, never invented data.
         */
        readonly roadmap: {
            /** Visible "coming soon" badge on every placeholder. */
            readonly comingSoon: string;
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
        };
    };
    /** Copy for the sign-in / sign-up surface (U2). All auth copy is localized (repo mandate). */
    readonly auth: {
        /** Brand wordmark shown atop the sign-in / sign-up screens. */
        readonly brand: string;
        /** Sub-heading on the sign-up screen. */
        readonly createHeading: string;
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
        /** Primary create-account submit label. */
        readonly createAccountAction: string;
        /** Prompt beside the link that toggles from sign-in to sign-up. */
        readonly noAccountPrompt: string;
        /** Label of the link that toggles from sign-in to sign-up. */
        readonly signUpLink: string;
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
    };
    /**
     * Copy for the mobile impersonation notice. Administrator impersonation is deliberately unavailable in
     * the app, and the viewer is told so rather than shown a dead end.
     */
    readonly impersonation: {
        /** Heading of the notice. */
        readonly title: string;
        /** Body explaining why impersonation is unavailable on mobile. */
        readonly message: string;
        /** Appended when a session id is known, for support to correlate. Contains `{sessionId}`. */
        readonly sessionLabel: string;
    };
    readonly profile: {
        /** Field label for the display-name input (also its accessible name). */
        readonly displayName: string;
        /** Placeholder shown in the empty display-name field. */
        readonly displayNamePlaceholder: string;
        /** Section label above the avatar picker. */
        readonly avatarLabel: string;
        /** Accessible name of the avatar image preview. */
        readonly avatarImageLabel: string;
        /** Label of the control that opens the image picker to change the avatar. */
        readonly avatarChangeAction: string;
        /** Alert shown when picking or uploading a new avatar fails. */
        readonly avatarUploadError: string;
        /** Alert shown when the picked avatar exceeds the 5 MB limit, before upload. */
        readonly avatarTooLargeError: string;
        /** Alert shown when the picked avatar's type is outside the JPEG/PNG/WebP allowlist. */
        readonly avatarUnsupportedTypeError: string;
        /** Primary save action. */
        readonly save: string;
        /** Busy label shown while the profile save is in flight. */
        readonly saving: string;
        /** Accessible label for the profile-loading spinner. */
        readonly loading: string;
        /** Message shown when the profile fails to load. */
        readonly loadError: string;
    };
    /** Copy for the account hub (security + sign-out + danger zone entry) — U2. */
    readonly account: {
        /** Screen heading. */
        readonly heading: string;
        /** Fallback shown when the signed-in viewer has no primary email yet. */
        readonly signedInFallback: string;
        /** Heading of the security section. */
        readonly securityHeading: string;
        /** Body copy of the security section. */
        readonly securityBody: string;
        /** Label of the sign-out action. */
        readonly signOutAction: string;
        /** Busy label shown while the sign-out is in flight. */
        readonly signingOut: string;
        /** Alert shown when the sign-out fails, so the control is retryable rather than silent (ADR-0009). */
        readonly signOutFailed: string;
        /**
         * Alert shown when an account ERASURE was accepted (202) but the follow-up sign-out failed.
         * Deliberately distinct from `signOutFailed` and from the erasure dialog's own submit error: the
         * erasure DID succeed server-side, so telling the viewer to retry it would be a lie — the only
         * outstanding action is leaving the (now-destroyed) account's session.
         */
        readonly eraseSignOutFailed: string;
        /** Label of the back affordance returning to the profile surface. */
        readonly backAction: string;
        /** Label of the profile-surface entry point into this account hub. */
        readonly settingsAction: string;
    };
    readonly suspension: {
        readonly title: string;
        readonly message: string;
    };
    readonly recipes: {
        /** Accessible label shown while a single recipe's detail is loading. */
        readonly detailLoading: string;
        /** Message shown when a recipe's detail fails to load. */
        readonly detailError: string;
        /** Label of the back affordance on the recipe-detail screen. */
        readonly back: string;
        /** Label of the owner action that opens the recipe editor. */
        readonly editAction: string;
        /** Label of the owner action that opens the delete-confirmation dialog. */
        readonly deleteAction: string;
        /** Label of the owner action that opens the version-history screen. */
        readonly versionsAction: string;
        /** Reason shown when the private-visibility option is gated behind a premium plan (C-004). */
        readonly visibilityUpgradeReason: string;
        /** Alert shown when creating a recipe fails. */
        readonly createError: string;
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
    readonly recipePhotos: {
        /** Visible + accessible label of the control that opens the native image picker. */
        readonly addLabel: string;
        /** Alert shown when acquiring, uploading, or confirming a photo fails. */
        readonly uploadError: string;
        /** Alert shown when removing a photo fails. */
        readonly removeError: string;
        /** Alert shown when a picked asset's size exceeds the 5 MB limit (REQ-011), before upload starts. */
        readonly tooLargeError: string;
        /** Alert shown when a picked asset's type is outside the allowlist (REQ-012), before upload starts. */
        readonly unsupportedTypeError: string;
        /** Alert shown when Replace is pressed at the photo cap — a lossless swap needs a free slot (U6). */
        readonly replaceAtCapError: string;
    };
    readonly ingredientPicker: {
        /** Section heading for the ingredient typeahead. */
        readonly heading: string;
        /** Accessible label for the ingredient search field. */
        readonly searchLabel: string;
        /** Placeholder shown inside the ingredient search field. */
        readonly searchPlaceholder: string;
        /** Accessible label for the search field's clear (×) control (U6). */
        readonly searchClear: string;
        /** Badge next to the search box naming the ingredient database it searches (C5, wireframe
         *  recipe-edit.md:56 "[USDA database]"). */
        readonly usdaBadge: string;
        /*
         * ⛔ `searchUsdaFor` / `searchUsdaSoon` USED TO LIVE HERE, and are DELETED rather than renamed
         * (plan U29). They were the U6 seam's copy — a label plus a "Soon" tag for a control that did
         * nothing. U29 wires the control, so the tag describes nothing, and the label now belongs to
         * `IngredientLiveSearchMessages` in the SHARED feature package: BOTH pickers render it, and the two
         * app dictionaries have already drifted on every string they share (`noMatches` vs `empty`,
         * `addFreeform` vs `create`). A cook must be told the same thing about a shared external rate limit
         * on both platforms, because it IS the same limit.
         */
        /** Empty-state copy shown when a search returns no catalog matches. */
        readonly empty: string;
        /** Heading of the "your own previously-used ingredients" section of the blended typeahead (Stage 2). */
        readonly ownSectionTitle: string;
        /** Heading of the food-catalog (USDA-seeded golden records) section of the blended typeahead. */
        readonly catalogSectionTitle: string;
        /** Provenance badge on a food-catalog row (it is not yet one of the caller's ingredients). */
        readonly catalogBadge: string;
        /** Non-blocking notice shown when the food catalog is unreachable and only local matches rendered (F2). */
        readonly catalogUnavailable: string;
        /** Busy label shown while a picked food-catalog row is being added. */
        readonly addingFromCatalog: string;
        /** Message shown when adding a picked food-catalog row fails. */
        readonly catalogAddError: string;
        /** Primary "find nutrition" action for a typed name (addByName, the async-resolution entry point; contains `{query}`). */
        readonly addByName: string;
        /** Busy label shown while a food is being added by name (food-resolution in flight). */
        readonly addingByName: string;
        /** Message shown when adding a food by name fails. */
        readonly addByNameError: string;
        /** Create-a-freeform-ingredient (fallback) action template (contains `{query}`). */
        readonly create: string;
        /** Busy label shown while a freeform ingredient is being created. */
        readonly creating: string;
        /** Heading for the disambiguation panel of an `UNRESOLVED` match (contains `{name}`). */
        readonly disambiguateTitle: string;
        /** Busy label shown while disambiguation candidates load. */
        readonly disambiguateLoading: string;
        /** Message shown when loading disambiguation candidates fails. */
        readonly disambiguateError: string;
        /** Copy shown when an `UNRESOLVED` match has no candidates to choose from. */
        readonly disambiguateEmpty: string;
        /** Label of the action that leaves the disambiguation panel and returns to search. */
        readonly disambiguateBack: string;
        /** Busy label shown while the picked candidate resolves. */
        readonly resolving: string;
        /** Message shown when resolving the picked candidate fails. */
        readonly resolveError: string;
    };
    readonly collections: {
        /** Accessible label shown while a single collection is loading. */
        readonly detailLoading: string;
        /** Message shown when a collection fails to load. */
        readonly detailError: string;
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
        /** Label of the retry affordance on the root-level crash fallback. */
        readonly retry: string;
    };
}

export const mobileMessages: LocalizedMessages<MobileMessages> = {
    en: {
        home: {
            greetings: {
                morning: 'Good morning, Chef!',
                afternoon: 'Good afternoon, Chef!',
                evening: 'Good evening, Chef!',
                night: 'Still up, Chef?',
            },
            regionLabel: 'Home',
            seeAllRecipes: 'See all recipes',
            widgetError: 'This section couldn’t load.',
            chrome: {
                pageTitle: 'Home',
                search: 'Search',
                notifications: 'Notifications',
                account: 'Account',
                accountNoName: 'Your account',
                tabNavLabel: 'Main',
                comingSoonSuffix: 'coming soon',
                destinations: {
                    home: 'Home',
                    recipes: 'Recipes',
                    'meal-plan': 'Meal Plan',
                    grocery: 'Grocery',
                    nutrition: 'Nutrition',
                    profile: 'Profile',
                },
            },
            roadmap: {
                comingSoon: 'Coming soon',
                titles: {
                    nutrition: "Today's Nutrition",
                    'resume-cooking': 'Resume cooking',
                    'meal-plan': "This Week's Meals",
                },
            },
            nudge: {
                title: 'Unlock Commise Pro',
                body: 'Upgrade to Commise Pro to use this feature.',
                upgrade: 'See plans',
                dismiss: 'Maybe later',
            },
        },
        auth: {
            brand: 'Commise',
            createHeading: 'Create your account',
            emailLabel: 'Email',
            emailPlaceholder: 'you@example.com',
            passwordLabel: 'Password',
            passwordPlaceholder: 'Your password',
            codeLabel: 'Verification code',
            codePlaceholder: '123456',
            codePrompt: 'Enter the verification code sent to your email.',
            signInAction: 'Sign in',
            verifyAction: 'Verify',
            createAccountAction: 'Create account',
            noAccountPrompt: 'Don’t have an account?',
            signUpLink: 'Sign up',
            haveAccountPrompt: 'Already have an account?',
            signInLink: 'Sign in',
            signInFailed: 'We couldn’t sign you in. Please try again.',
            signUpFailed: 'We couldn’t create your account. Please try again.',
            verifyFailed: 'We couldn’t verify that code. Please try again.',
            sendCodeFailed: 'We couldn’t send a verification code. Please try again.',
            additionalVerification: 'Additional verification is required to finish signing in.',
            sessionLoading: 'Checking your session…',
        },
        impersonation: {
            title: 'Impersonation blocked on mobile',
            message: 'For account safety, administrator impersonation is not available in the mobile app.',
            sessionLabel: 'Session: {sessionId}',
        },
        profile: {
            displayName: 'Display name',
            displayNamePlaceholder: 'Your name',
            avatarLabel: 'Profile photo',
            avatarImageLabel: 'Your profile photo',
            avatarChangeAction: 'Change photo',
            avatarUploadError: 'We couldn’t update your photo. Please try again.',
            avatarTooLargeError: 'That photo is larger than 5 MB. Choose a smaller file.',
            avatarUnsupportedTypeError: 'That file type isn’t supported. Use a JPEG, PNG, or WebP photo.',
            save: 'Save',
            saving: 'Saving…',
            loading: 'Loading your profile…',
            loadError: 'Failed to load profile.',
        },
        account: {
            heading: 'Account',
            signedInFallback: 'Signed in',
            securityHeading: 'Security',
            securityBody: 'Manage your password, MFA, and linked social accounts from the IdP-hosted user profile.',
            signOutAction: 'Sign out',
            signingOut: 'Signing out…',
            signOutFailed: 'We couldn’t sign you out. Please try again.',
            eraseSignOutFailed:
                'Your data is being erased, but we couldn’t sign you out. Sign out to finish leaving this account.',
            backAction: 'Back',
            settingsAction: 'Account settings',
        },
        suspension: {
            title: 'Account Suspended',
            message:
                'Your account is suspended. Commise access is paused until support restores your account. ' +
                'Please contact support if you believe this is a mistake.',
        },
        recipes: {
            detailLoading: 'Loading recipe…',
            detailError: 'We couldn’t load this recipe.',
            back: 'Back',
            editAction: 'Edit recipe',
            deleteAction: 'Delete recipe',
            versionsAction: 'Version history',
            visibilityUpgradeReason: 'Upgrade to premium to make a recipe private.',
            createError: 'We couldn’t create your recipe. Please try again.',
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
        recipePhotos: {
            addLabel: 'Add photo',
            uploadError: 'We couldn’t add your photo. Please try again.',
            removeError: 'We couldn’t remove this photo. Please try again.',
            tooLargeError: 'That photo is larger than 5 MB. Choose a smaller file.',
            unsupportedTypeError: 'That file type isn’t supported. Use a JPEG, PNG, or WebP photo.',
            replaceAtCapError: 'Remove a photo first — replacing needs room for the new one.',
        },
        ingredientPicker: {
            heading: 'Add an ingredient',
            searchLabel: 'Search ingredients',
            searchPlaceholder: 'e.g. olive oil',
            searchClear: 'Clear search',
            usdaBadge: 'USDA database',
            empty: 'No matching ingredients. Create a new one below.',
            ownSectionTitle: 'Your ingredients',
            catalogSectionTitle: 'Food catalog',
            catalogBadge: 'USDA',
            catalogUnavailable: 'Showing your ingredients only — the food catalog is unavailable right now.',
            addingFromCatalog: 'Adding from the food catalog…',
            catalogAddError: 'We couldn’t add that food. Try again, or create a custom one below.',
            addByName: 'Find nutrition for “{query}”',
            addingByName: 'Finding nutrition…',
            addByNameError: 'We couldn’t add that ingredient. Create a custom one below instead.',
            create: 'Create “{query}”',
            creating: 'Adding…',
            disambiguateTitle: 'Which “{name}” did you mean?',
            disambiguateLoading: 'Loading options…',
            disambiguateError: 'We couldn’t load options for that ingredient.',
            disambiguateEmpty: 'No options to choose from — create a custom one below.',
            disambiguateBack: 'Back to search',
            resolving: 'Resolving…',
            resolveError: 'We couldn’t resolve that ingredient.',
        },
        collections: {
            detailLoading: 'Loading collection…',
            detailError: 'We couldn’t load this collection.',
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
            rootErrorBody: 'We hit a snag loading this screen. Please try again.',
            retry: 'Try again',
        },
    },
};
