/**
 * @module components/auth/messages — user-facing copy for the web identity/auth surface (U3).
 *
 * The `/account`, `/settings`, and `/profile` routes plus their forms were the last unstyled, un-localized
 * corner of the web app (RC-1). This dictionary is their single source of copy: the server route content
 * resolves it via `resolveMessages(authMessages, locale)`, and the client controls (edit form, state gate,
 * logout) resolve the SAME dictionary via `useMessages` — so the two never drift and no user string is a
 * hard-coded literal (repo localization mandate). The danger-zone copy (close/erase) is NOT duplicated here;
 * it lives in `@commise/features-account/danger` (`accountDangerMessages`) and is consumed directly.
 *
 * The `en` set is required and is the guaranteed fallback; adding a locale is another key.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for the `/account` page shell (headings only — the forms carry their own sections). */
export interface AccountPageMessages {
    /** Page heading / metadata title. */
    readonly title: string;
    /** Heading of the profile-edit section. */
    readonly editHeading: string;
    /** Heading of the destructive danger-zone section. */
    readonly dangerHeading: string;
    /**
     * Status shown in place of the edit form when the identity service is briefly unreachable — the page
     * degrades (heading + danger zone still usable) instead of throwing the route into its error boundary.
     */
    readonly loadError: string;
}

/** Copy for the `AccountEditForm` profile-edit control. */
export interface AccountEditMessages {
    /** Accessible name of the form. */
    readonly formLabel: string;
    /** Label of the display-name field. */
    readonly displayNameLabel: string;
    /** Label of the avatar-URL field. */
    readonly avatarUrlLabel: string;
    /** Placeholder shown in the empty avatar-URL field (a format hint). */
    readonly avatarUrlPlaceholder: string;
    /** Submit label at rest. */
    readonly save: string;
    /** Submit label while a save is in flight. */
    readonly saving: string;
    /** Error shown when the session token is missing (never fail silently — B17). */
    readonly notAuthenticated: string;
    /** Error shown when the save request fails. */
    readonly updateFailed: string;
}

/** Copy for the `/settings` page. */
export interface SettingsPageMessages {
    /** Page heading / metadata title. */
    readonly title: string;
    /** Heading of the session section. */
    readonly sessionHeading: string;
}

/** Copy for the `/profile` page (view of the resolved identity). */
export interface ProfilePageMessages {
    /** Page heading / metadata title. */
    readonly title: string;
    /** Status shown when the identity service is briefly unreachable (SSR degrade, not a crash). */
    readonly loadError: string;
    /** Heading of the personal-information section. */
    readonly infoHeading: string;
    /** Term label for the display name. */
    readonly displayNameLabel: string;
    /** Term label for the email. */
    readonly emailLabel: string;
    /** Term label for the account status. */
    readonly statusLabel: string;
    /** Heading of the account-details section. */
    readonly accountHeading: string;
    /** Term label for the subscription tier. */
    readonly subscriptionTierLabel: string;
}

/** Copy shared by the session control (`LogoutButton`). */
export interface SessionMessages {
    /** Default label of the sign-out control. */
    readonly signOut: string;
    /** Busy label shown while signing out is in flight. */
    readonly signingOut: string;
    /** Alert shown when the sign-out itself fails, so the control is retryable rather than stuck (B17). */
    readonly signOutFailed: string;
    /**
     * Alert shown when an account ERASURE was accepted (202) but the follow-up sign-out / navigation failed.
     * Deliberately distinct from {@link signOutFailed} and from the erasure dialog's own submit error: the
     * erasure DID succeed, so telling the viewer to retry it would be a lie — the outstanding action is only
     * to leave the (now-destroyed) account's session.
     */
    readonly eraseSignOutFailed: string;
}

/** Copy for the `AccountStateGate` load gap. */
export interface AccountStateMessages {
    /** Accessible status shown while the client resolves the account state. */
    readonly loading: string;
}

/** The shape of the web auth surface's copy. */
export interface AuthMessages {
    /** `/account` page shell copy. */
    readonly account: AccountPageMessages;
    /** Profile-edit form copy. */
    readonly edit: AccountEditMessages;
    /** `/settings` page copy. */
    readonly settings: SettingsPageMessages;
    /** `/profile` page copy. */
    readonly profile: ProfilePageMessages;
    /** Session (sign-out) copy. */
    readonly session: SessionMessages;
    /** Account-state gate copy. */
    readonly state: AccountStateMessages;
}

/** The web auth surface's localized copy. The `en` set is required. */
export const authMessages: LocalizedMessages<AuthMessages> = {
    en: {
        account: {
            title: 'Account Settings',
            editHeading: 'Edit Profile',
            dangerHeading: 'Danger Zone',
            loadError: 'We couldn’t load your profile right now. Please try again shortly.',
        },
        edit: {
            formLabel: 'Account edit form',
            displayNameLabel: 'Display Name',
            avatarUrlLabel: 'Avatar URL',
            avatarUrlPlaceholder: 'https://…',
            save: 'Save Changes',
            saving: 'Saving…',
            notAuthenticated: 'You’re not signed in. Please sign in and try again.',
            updateFailed: 'We couldn’t save your changes. Please try again.',
        },
        settings: {
            title: 'Settings',
            sessionHeading: 'Session',
        },
        profile: {
            title: 'Profile',
            loadError: 'We couldn’t load your profile right now. Please try again shortly.',
            infoHeading: 'Your Information',
            displayNameLabel: 'Display Name',
            emailLabel: 'Email',
            statusLabel: 'Status',
            accountHeading: 'Account',
            subscriptionTierLabel: 'Subscription Tier',
        },
        session: {
            signOut: 'Sign out of your account',
            signingOut: 'Signing out…',
            signOutFailed: 'We couldn’t sign you out. Please try again.',
            eraseSignOutFailed:
                'Your data is being erased, but we couldn’t sign you out. Sign out to finish leaving this account.',
        },
        state: {
            loading: 'Loading your account…',
        },
    },
};
