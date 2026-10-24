/**
 * @module components/SuspensionBanner — the mobile account-suspended notice.
 *
 * Renders the shared {@link AlertBanner} in the block tone, and only for a `suspended` account — the status
 * check lives here so no caller has to remember it.
 */
import { authBlockMessages } from '@commise/features-account';
import { useMessages } from '@commise/i18n/react';
import type { UserStatus } from '@kitchensink/schema-identity';
import type { JSX } from 'react';

import { AlertBanner } from './AlertBanner';

/** Props for {@link SuspensionBanner}. */
interface SuspensionBannerProps {
    /** The viewer's account status; the banner renders only for `suspended`. */
    readonly status: UserStatus;
}

/**
 * The account-suspended notice.
 *
 * @param props - The viewer's account `status`.
 * @returns The banner for a suspended account, otherwise `null`.
 */
export function SuspensionBanner({ status }: SuspensionBannerProps): JSX.Element | null {
    const { account_suspended: suspended } = useMessages(authBlockMessages);

    if (status !== 'suspended') {
        return null;
    }

    return <AlertBanner accent="danger" title={suspended.title} body={suspended.body} />;
}
