'use client';

/**
 * @module @commise/features-account/profile/ProfileAccountGroup — the Profile page's "Account" group, once for both apps:
 * the display-name row that opens the editor sheet, with whatever read-only rows the platform adds after it.
 *
 * Both pages drew the same row with the same value rule (the name, or "Add your name" when none is saved). They differ
 * only in what follows it, and that is a decision for the page: web adds username and email rows, mobile adds none.
 * Those rows arrive as `children`, so this group neither knows nor changes which rows either platform shows.
 *
 * Presentational: props → JSX. The leaves it composes (`ProfileGroup`, `ProfileRow`) resolve to their web or native file at bundle time, so this one
 * module serves both platforms.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactNode } from 'react';

import { profileMessages } from './messages.js';
import { ProfileGroup } from './ProfileGroup.js';
import { ProfileRow } from './ProfileRow.js';

/** Props of {@link ProfileAccountGroup}. */
export interface ProfileAccountGroupProps {
    /** The saved display name (empty when none is saved). */
    readonly displayName: string;
    /** Open the display-name editor. */
    readonly onEditDisplayName: () => void;
    /** Read-only rows the platform shows after the display name. */
    readonly children?: ReactNode;
}

/** The "Account" group. */
export const ProfileAccountGroup: FC<ProfileAccountGroupProps> = ({ displayName, onEditDisplayName, children }) => {
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
            {children}
        </ProfileGroup>
    );
};
