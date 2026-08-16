/**
 * @module @commise/features-account/danger/messages — shared, platform-neutral copy for the account
 * danger-zone (CR-002 / U4b). The whole point of this slice is to make CLOSURE and ERASURE read as two
 * DIFFERENT actions with different consequences: closure is recoverable (data retained), erasure is
 * irreversible (data destroyed). Both the web `.tsx` and native `.native.tsx` erasure leaves consume the
 * `erase` copy via `useMessages`; the app containers consume the `close` copy for the `@commise/ui`
 * `ConfirmDialog`. The `en` set is required; adding a locale is another key.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for account CLOSURE — the RECOVERABLE action (identity ban + tombstone; data retained). */
export interface AccountCloseMessages {
    /** Label of the danger-zone control that opens the close confirmation. */
    readonly trigger: string;
    /** Confirmation title / accessible name. */
    readonly title: string;
    /** Body copy — MUST convey that this is recoverable and NOT permanent deletion. */
    readonly description: string;
    /** Label of the confirm action. */
    readonly confirm: string;
    /** Label of the dismiss action. */
    readonly cancel: string;
    /** Busy indicator shown while closing is in flight. */
    readonly busyLabel: string;
    /** Error shown when closing fails, so it never silently stops (B17). */
    readonly error: string;
}

/** Copy for account ERASURE — the IRREVERSIBLE action (GDPR erasure + Clerk delete; data destroyed). */
export interface AccountEraseMessages {
    /** Label of the danger-zone control that opens the erasure dialog. */
    readonly trigger: string;
    /** Dialog title / accessible name. */
    readonly title: string;
    /** The primary irreversibility warning. */
    readonly warning: string;
    /** The explicit contrast with closure, so the two actions can never be conflated. */
    readonly distinction: string;
    /** Heading of the donate-election section. */
    readonly donateHeading: string;
    /** Help text beside the election — the permanence of donating (mirrors the server's publish warning). */
    readonly donateHelp: string;
    /** Shown when the owner has no owner-only recipes to offer for donation. */
    readonly donateEmpty: string;
    /** Accessible label for the "loading your recipes" status. */
    readonly recipesLoadingLabel: string;
    /** Shown when the recipe list failed to load — erasure still proceeds; nothing is published (B17). */
    readonly recipesError: string;
    /** Visible instruction above the phrase field (contains `{phrase}`). */
    readonly phrasePrompt: string;
    /** Accessible label of the confirmation-phrase input. */
    readonly phraseLabel: string;
    /** Label of the destructive confirm action. */
    readonly confirm: string;
    /** Label of the dismiss action. */
    readonly cancel: string;
    /** Busy indicator shown while the erasure request is in flight. */
    readonly busyLabel: string;
    /** Error shown when starting the erasure fails, so it never silently stops (B17). */
    readonly error: string;
}

/** The shape of the account danger-zone's shared copy. */
export interface AccountDangerMessages {
    /** Copy for the recoverable close action. */
    readonly close: AccountCloseMessages;
    /** Copy for the irreversible erase action. */
    readonly erase: AccountEraseMessages;
}

export const accountDangerMessages: LocalizedMessages<AccountDangerMessages> = {
    en: {
        close: {
            trigger: 'Close account',
            title: 'Close account?',
            description:
                'Closing signs you out and deactivates your account. Your recipes and data are kept, and you ' +
                'can restore your account by contacting support. This is not permanent deletion — to erase your ' +
                'data for good, use “Erase my data” instead.',
            confirm: 'Close account',
            cancel: 'Cancel',
            busyLabel: 'Closing…',
            error: 'We couldn’t close your account. Please try again.',
        },
        erase: {
            trigger: 'Erase my data',
            title: 'Erase my data',
            warning:
                'This permanently deletes your account and erases your personal data everywhere we hold it — ' +
                'your sign-in, your profile and photo, and your private recipes, ratings and collections. ' +
                'You will be signed out and will not be able to sign in again. It cannot be undone.',
            distinction:
                'This is not the same as closing your account: closing is recoverable, but erasing destroys ' +
                'your data for good and cannot be reversed.',
            donateHeading: 'Choose recipes to keep public',
            donateHelp:
                'Recipes you choose here become public and are permanently unremovable by you once your ' +
                'account is erased. Everything you don’t choose is deleted.',
            donateEmpty: 'You have no private recipes to publish. Everything will be deleted.',
            recipesLoadingLabel: 'Loading your recipes',
            recipesError:
                'We couldn’t load your recipes, so none are listed to keep. You can still erase your data — ' +
                'nothing will be published.',
            phrasePrompt: 'To confirm, type {phrase} below.',
            phraseLabel: 'Confirmation phrase',
            confirm: 'Erase my data',
            cancel: 'Cancel',
            busyLabel: 'Erasing…',
            error: 'We couldn’t start erasing your data. Please try again.',
        },
    },
};
