/**
 * Mobile-app-specific user-facing copy (strings that live only in the mobile app). Shared, cross-platform
 * copy lives in the feature packages' `messages.ts`. A {@link LocalizedMessages} dictionary resolved per
 * active locale via `useMessages` from `@commise/i18n/react`. The `en` set is required.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** The shape of the mobile app's own copy. */
export interface MobileMessages {
    readonly profile: {
        readonly displayName: string;
        readonly avatarUrl: string;
        readonly save: string;
        readonly saving: string;
        readonly loadError: string;
    };
    readonly suspension: {
        readonly title: string;
        readonly message: string;
    };
    readonly common: {
        readonly somethingWentWrong: string;
    };
}

export const mobileMessages: LocalizedMessages<MobileMessages> = {
    en: {
        profile: {
            displayName: 'Display name',
            avatarUrl: 'Avatar URL',
            save: 'Save',
            saving: 'Saving…',
            loadError: 'Failed to load profile.',
        },
        suspension: {
            title: 'Account Suspended',
            message:
                'Your account is suspended. Commise access is paused until support restores your account. ' +
                'Please contact support if you believe this is a mistake.',
        },
        common: {
            somethingWentWrong: 'Something went wrong',
        },
    },
};
