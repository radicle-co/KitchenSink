/**
 * @module @commise/features-account/profile/messages — the Profile page's copy, once for both apps
 * (`docs/design/uiOverhaul/buildSpec.md` §9.1). Web and native render the same page, so they read one dictionary and
 * cannot drift; the danger rows' hints live beside the dialogs they open (`accountDangerMessages`).
 *
 * The `en` set is required; adding a locale is another key.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** The Profile page's copy. */
export interface ProfileMessages {
    /** The page's H1 and its document title. */
    readonly title: string;
    /** Web's "Back to {parent}" for a Profile opened from anywhere: Home is its parent. */
    readonly backToHome: string;
    /** The parent's name in the 840+ eyebrow ("‹ Home"). */
    readonly homeParent: string;
    /** The Data sources page's way back to Profile. */
    readonly backToProfile: string;
    /** Native's back control: the tab stack knows no single parent. */
    readonly back: string;
    /** The accessible name of the loading skeleton. */
    readonly loading: string;
    /** Shown in place of the header and rows' values when the read failed; the groups still work. */
    readonly loadError: string;
    /** The retry control beside {@link loadError}. */
    readonly retry: string;
    /** The accessible name of the group holding the display name and the email. */
    readonly account: string;
    /** The label of the display-name row. */
    readonly displayName: string;
    /** The row's value while no name is set. */
    readonly displayNameUnset: string;
    /** The label of the email row. */
    readonly email: string;
    /** The sheet's title. */
    readonly namePrompt: string;
    /** The hint under the display-name field: where the name shows. */
    readonly nameHint: string;
    /** The sheet's primary action. */
    readonly save: string;
    /** The primary action while the save is in flight. */
    readonly saving: string;
    /** The snackbar after a save. */
    readonly saved: string;
    /** Shown in the sheet when the save failed, so it never stops silently. */
    readonly saveFailed: string;
    /** The sheet's close control. */
    readonly closeNameSheet: string;
    /** The Preferences group's heading. */
    readonly preferences: string;
    /** The row that opens the data sources page. */
    readonly dataSources: string;
    /** Web's switch that turns the `/` shortcut off (SC 2.1.4). */
    readonly shortcuts: string;
    /** The alert under Preferences when saving a setting failed and the switch went back (D19). */
    readonly settingSaveFailed: string;
    /** The sign-out row. */
    readonly signOut: string;
    /** The sign-out row while the session is ending. */
    readonly signingOut: string;
    /** The alert when sign-out failed, so the row is retryable. */
    readonly signOutFailed: string;
    /** The Danger zone group's heading. */
    readonly dangerZone: string;
}

/** The Profile page's localized copy. */
export const profileMessages: LocalizedMessages<ProfileMessages> = {
    en: {
        title: 'Profile',
        backToHome: 'Back to Home',
        homeParent: 'Home',
        backToProfile: 'Back to Profile',
        back: 'Back',
        loading: 'Loading your profile',
        loadError: 'We couldn’t load your profile.',
        retry: 'Try again',
        account: 'Account',
        displayName: 'Display name',
        displayNameUnset: 'Add your name',
        email: 'Email',
        namePrompt: 'What should we call you?',
        nameHint: 'Shown on recipes you publish.',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved.',
        saveFailed: 'We couldn’t save your name. Try again.',
        closeNameSheet: 'Close',
        preferences: 'Preferences',
        dataSources: 'Food data sources',
        shortcuts: 'Keyboard shortcuts',
        settingSaveFailed: 'We couldn’t save that setting. Try again.',
        signOut: 'Sign out',
        signingOut: 'Signing out…',
        signOutFailed: 'We couldn’t sign you out. Try again.',
        dangerZone: 'Danger zone',
    },
};
