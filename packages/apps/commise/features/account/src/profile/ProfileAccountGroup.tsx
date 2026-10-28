'use client';

/**
 * @module @commise/features-account/profile/ProfileAccountGroup — the Profile page's "Account" group, once for both apps:
 * the display-name row that opens the editor sheet.
 *
 * Both pages draw the same row with the same value rule (the name, or "Add your name" when none is saved). After it come
 * the read-only Username (only when the cook has one — never a "Not set" they cannot act on) and Email rows. They show
 * here once and not in the header (owner ruling S2, 2026-10-27, replacing the 2026-10-16 ruling that read them there).
 *
 * Presentational: props → JSX. The leaves it composes (`ProfileGroup`, `ProfileRow`) resolve to their web or native file at bundle time, so this one
 * module serves both platforms.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { profileMessages } from './messages.js';
import { formatUsername } from './model.js';
import { ProfileFactRow } from './ProfileFactRow.js';
import { ProfileGroup } from './ProfileGroup.js';
import { ProfileRow } from './ProfileRow.js';

/** Props of {@link ProfileAccountGroup}. */
export interface ProfileAccountGroupProps {
    /** The saved display name (empty when none is saved). */
    readonly displayName: string;
    /** The Clerk username, or `null` when the cook has none. */
    readonly username: string | null;
    /** The account's email. */
    readonly email: string;
    /** Open the display-name editor. */
    readonly onEditDisplayName: () => void;
}

/** The "Account" group. */
export const ProfileAccountGroup: FC<ProfileAccountGroupProps> = ({
    displayName,
    username,
    email,
    onEditDisplayName,
}) => {
    const t = useMessages(profileMessages);

    return (
        <ProfileGroup label={t.account}>
            <ProfileRow
                label={t.displayName}
                value={displayName === '' ? t.displayNameUnset : displayName}
                tone="ink"
                chevron
                onPress={onEditDisplayName}
            />
            {username === null ? null : (
                <ProfileFactRow label={t.usernameLabel} value={formatUsername(t.usernameValue, username)} />
            )}
            <ProfileFactRow label={t.emailLabel} value={email} />
        </ProfileGroup>
    );
};
