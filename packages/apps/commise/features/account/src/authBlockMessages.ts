/**
 * @module @commise/features-account/authBlockMessages — the localized words a viewer reads when their session is
 * blocked, keyed by the block's code (`AuthBlockReason`).
 *
 * One fact, one wording. It used to be three: hard-coded English inside `deriveAuthState`'s result (shown by web's
 * `AccountStateGate` and mobile's `AuthGate`), and a second, longer suspended wording in mobile's own dictionary (shown by
 * the Profile page's banner). A string inside a pure state derivation also cannot be localized.
 *
 * The suspended body is the longer of the two wordings: it says what is paused and who can lift it, which the shorter one
 * did not. The title takes the shared sentence case ("Account suspended", like "Account closed").
 *
 * Impersonation has no mobile-specific wording: the mobile-only "Impersonation blocked on mobile" notice was unreachable
 * (its component was never rendered) and is deleted.
 */
import type { LocalizedMessages } from '@commise/i18n';

import type { AuthBlockReason } from './authState.js';

/** The title and body of one block notice. */
export interface AuthBlockCopy {
    readonly title: string;
    readonly body: string;
}

/** The copy of every block, keyed by its code. A new code is a compile error here until it has words. */
export type AuthBlockMessages = Readonly<Record<AuthBlockReason['code'], AuthBlockCopy>>;

export const authBlockMessages: LocalizedMessages<AuthBlockMessages> = {
    en: {
        account_suspended: {
            title: 'Account suspended',
            body:
                'Your account is suspended. Commise access is paused until support restores your account. ' +
                'Please contact support if you believe this is a mistake.',
        },
        impersonation_blocked: {
            title: 'Impersonation blocked',
            body: 'Impersonated sessions cannot access Commise.',
        },
    },
};
