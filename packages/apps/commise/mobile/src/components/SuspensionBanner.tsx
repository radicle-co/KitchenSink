/**
 * @module components/SuspensionBanner — the mobile account-suspended notice.
 *
 * Renders the shared {@link AlertBanner} in the block tone, and only for a `suspended` account — the status
 * check lives here so no caller has to remember it.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { UserStatus } from '@kitchensink/schema-identity';
import type { JSX } from 'react';

import { mobileMessages } from '../i18n/messages';
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
    const { suspension } = useMessages(mobileMessages);

    if (status !== 'suspended') {
        return null;
    }

    return <AlertBanner accent={palette.error} title={suspension.title} body={suspension.message} />;
}
