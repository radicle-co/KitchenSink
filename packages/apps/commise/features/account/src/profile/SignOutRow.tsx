'use client';

/**
 * @module @commise/features-account/profile/SignOutRow — the Profile page's sign-out row (web): an `ink` {@link ProfileRow}
 * named by its state, with the localized failure beneath it as an alert. Signing out is not destructive, so it is never
 * red (`buildSpec.md` §9.1).
 *
 * Presentational: props → JSX. It draws; it does not sign out. The app's control feeds it `useSignOutControl`'s state and its one verified sign-out
 * command (ADR-0009), so the same leaf serves the Profile page's sign-out group and the danger zone's recovery after an
 * erasure that was accepted but whose exit failed.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { profileMessages } from './messages.js';
import { ProfileRow } from './ProfileRow.js';
import type { SignOutRowProps } from './props.js';

/** The sign-out row and its failure alert. */
export const SignOutRow: FC<SignOutRowProps> = ({ busy, failed, onPress }) => {
    const t = useMessages(profileMessages);

    return (
        <>
            <ProfileRow
                label={busy ? t.signingOut : t.signOut}
                tone="ink"
                chevron={false}
                busy={busy}
                onPress={onPress}
            />
            {failed ? (
                <p role="alert" className="px-4 pb-3 text-meta text-danger-text">
                    {t.signOutFailed}
                </p>
            ) : null}
        </>
    );
};
