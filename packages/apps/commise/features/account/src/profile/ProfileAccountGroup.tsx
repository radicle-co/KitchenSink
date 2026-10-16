'use client';

/**
 * @module @commise/features-account/profile/ProfileAccountGroup — the Profile page's "Account" group, once for both apps:
 * the display-name row that opens the editor sheet.
 *
 * Both pages draw the same row with the same value rule (the name, or "Add your name" when none is saved). The username
 * and email are read once, in the header, on both apps (owner ruling 2026-10-16), so this group holds no read-only rows.
 *
 * Presentational: props → JSX. The leaves it composes (`ProfileGroup`, `ProfileRow`) resolve to their web or native file at bundle time, so this one
 * module serves both platforms.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { profileMessages } from './messages.js';
import { ProfileGroup } from './ProfileGroup.js';
import { ProfileRow } from './ProfileRow.js';

/** Props of {@link ProfileAccountGroup}. */
export interface ProfileAccountGroupProps {
    /** The saved display name (empty when none is saved). */
    readonly displayName: string;
    /** Open the display-name editor. */
    readonly onEditDisplayName: () => void;
}

/** The "Account" group. */
export const ProfileAccountGroup: FC<ProfileAccountGroupProps> = ({ displayName, onEditDisplayName }) => {
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
        </ProfileGroup>
    );
};
